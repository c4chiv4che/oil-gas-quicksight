"""Export Athena query results to JSON files for the demo frontend.

Run locally with AWS_PROFILE=oil-gas-dev. Writes to data/demo/ at repo root.
"""
import json
import time
from pathlib import Path

import boto3

REGION = "us-east-1"
WORKGROUP = "oil-gas-wg"
DATABASE = "oil_gas_db"
OUTPUT_LOCATION = "s3://vaca-muerta-athena-results-919064997947/"
POLL_INTERVAL_SECONDS = 1

OUTPUT_DIR = Path(__file__).resolve().parents[1] / "data" / "demo"

FLOAT_TYPES = {"double", "float", "real", "decimal"}
INT_TYPES = {"bigint", "integer", "int", "tinyint", "smallint"}
BOOL_TYPES = {"boolean"}

QUERIES = [
    (
        "wells_esd.json",
        """
        SELECT timestamp, well_id, well_state, shutdown_reason, whp, chp, tt_flow,
               ft_oil, ft_gas, ft_water, pt_downhole, corrosion_risk, hydrate_risk
        FROM oil_gas_db.wells
        WHERE date='2026-03-15'
        ORDER BY well_id, timestamp
        """,
    ),
    (
        "utilities_esd.json",
        """
        SELECT timestamp, esd_phase, esd_reason, ft_flare_hp, tt_hotoil_supply,
               tt_hotoil_return, qi_flare_smoke
        FROM oil_gas_db.utilities
        WHERE date='2026-03-15'
        ORDER BY timestamp
        """,
    ),
    (
        "plant_esd.json",
        """
        SELECT timestamp, plant_event, esd_phase, ai_wobbe, ai_pcs
        FROM oil_gas_db.plant
        WHERE date='2026-03-15'
        ORDER BY timestamp
        """,
    ),
    (
        "esd_events.json",
        """
        SELECT esd_phase, esd_reason, minutes_in_phase, phase_start, phase_end,
               peak_flare_hp_mm3d, avg_flare_hp_mm3d, min_hotoil_supply_c,
               max_hotoil_supply_c
        FROM oil_gas_db.curated_esd_events
        ORDER BY phase_start
        """,
    ),
]


def _cast(value, athena_type):
    if value is None:
        return None
    t = athena_type.lower()
    if t in FLOAT_TYPES:
        return float(value)
    if t in INT_TYPES:
        return int(value)
    if t in BOOL_TYPES:
        return value.lower() == "true"
    return value


def run_query(athena, sql):
    exec_id = athena.start_query_execution(
        QueryString=sql,
        QueryExecutionContext={"Database": DATABASE},
        WorkGroup=WORKGROUP,
        ResultConfiguration={"OutputLocation": OUTPUT_LOCATION},
    )["QueryExecutionId"]

    while True:
        status = athena.get_query_execution(QueryExecutionId=exec_id)["QueryExecution"]["Status"]
        state = status["State"]
        if state == "SUCCEEDED":
            break
        if state in ("FAILED", "CANCELLED"):
            reason = status.get("StateChangeReason", "no reason provided")
            raise RuntimeError(f"Athena query {state} ({exec_id}): {reason}")
        time.sleep(POLL_INTERVAL_SECONDS)

    paginator = athena.get_paginator("get_query_results")
    headers = None
    column_types = None
    rows = []
    for page_index, page in enumerate(paginator.paginate(QueryExecutionId=exec_id)):
        result_set = page["ResultSet"]
        if page_index == 0:
            column_info = result_set["ResultSetMetadata"]["ColumnInfo"]
            headers = [c["Name"] for c in column_info]
            column_types = [c["Type"] for c in column_info]
            page_rows = result_set["Rows"][1:]
        else:
            page_rows = result_set["Rows"]
        for r in page_rows:
            cells = r["Data"]
            record = {}
            for name, atype, cell in zip(headers, column_types, cells):
                record[name] = _cast(cell.get("VarCharValue"), atype)
            rows.append(record)
    return rows


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    athena = boto3.Session(region_name=REGION).client("athena")

    results = []
    for filename, sql in QUERIES:
        path = OUTPUT_DIR / filename
        print(f"[{filename}] running query...")
        try:
            rows = run_query(athena, sql.strip())
            with path.open("w", encoding="utf-8") as f:
                json.dump(rows, f, indent=2, ensure_ascii=False)
            print(f"[{filename}] OK — {len(rows)} rows -> {path}")
            results.append((filename, "OK", len(rows), str(path)))
        except Exception as e:
            print(f"[{filename}] FAILED — {e}")
            results.append((filename, "FAILED", str(e), str(path)))

    print("\n=== Summary ===")
    ok = [r for r in results if r[1] == "OK"]
    fail = [r for r in results if r[1] == "FAILED"]
    for name, _, count, path in ok:
        print(f"  OK     {name:24s} {count:>6} rows  {path}")
    for name, _, err, _ in fail:
        print(f"  FAILED {name:24s} {err}")
    print(f"\n{len(ok)}/{len(results)} queries succeeded.")


if __name__ == "__main__":
    main()
