"""
Vaca Muerta Shale — Synthetic OT Data Simulator
Generates realistic time-series signals for a multi-well pad.
"""

import random
import math
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import numpy as np
import pandas as pd
import boto3
from botocore.config import Config
from rich.console import Console
from rich.progress import track

console = Console()

# ─────────────────────────────────────────────
# PHYSICAL CONSTANTS & REALISTIC RANGES
# Vaca Muerta horizontal well, ESP-lifted
# ─────────────────────────────────────────────
PAD_CONFIG = {
    "pad_id": "PAD-LLL-01",
    "formation": "Vaca Muerta",
    "basin": "Neuquén",
    "wells": [
        {"well_id": "LLL-001", "first_production": "2024-01-15", "lateral_length_m": 2800, "stages": 45},
        {"well_id": "LLL-002", "first_production": "2024-02-01", "lateral_length_m": 3100, "stages": 50},
        {"well_id": "LLL-003", "first_production": "2024-03-10", "lateral_length_m": 2950, "stages": 48},
        {"well_id": "LLL-004", "first_production": "2024-04-20", "lateral_length_m": 3050, "stages": 49},
    ]
}

SIGNAL_RANGES = {
    # Wellhead Pressure (bar)
    "whp_bar":        {"min": 20,   "max": 180,  "noise_pct": 0.005},
    # Casing Head Pressure (bar)
    "chp_bar":        {"min": 10,   "max": 80,   "noise_pct": 0.007},
    # Flowline Temperature (°C)
    "flowline_temp_c":{"min": 40,   "max": 95,   "noise_pct": 0.003},
    # Oil rate (m³/day)
    "oil_rate_m3d":   {"min": 0,    "max": 120,  "noise_pct": 0.02},
    # Gas rate (Mm³/day — thousand m³)
    "gas_rate_mm3d":  {"min": 0,    "max": 80,   "noise_pct": 0.025},
    # Produced water (m³/day)
    "water_rate_m3d": {"min": 0,    "max": 30,   "noise_pct": 0.015},
    # ESP motor current (A)
    "esp_current_a":  {"min": 40,   "max": 120,  "noise_pct": 0.008},
    # ESP frequency (Hz)
    "esp_freq_hz":    {"min": 35,   "max": 65,   "noise_pct": 0.002},
    # Choke position (% open)
    "choke_pct":      {"min": 0,    "max": 100,  "noise_pct": 0.001},
    # Downhole pressure (bar)  — calculado, no medido directo en todos
    "downhole_pres_bar": {"min": 180, "max": 420, "noise_pct": 0.004},
    # Gas-oil ratio (m³/m³)
    "gor_m3m3":       {"min": 100,  "max": 800,  "noise_pct": 0.03},
    # Water cut (fraction)
    "watercut_frac":  {"min": 0.02, "max": 0.45, "noise_pct": 0.01},
}

# ─────────────────────────────────────────────
# DECLINE CURVE  (Arps hyperbolic)
# q(t) = qi / (1 + b*Di*t)^(1/b)
# Vaca Muerta typical: b=1.3-1.8, Di=0.008-0.015 /day
# ─────────────────────────────────────────────
def hyperbolic_decline(qi: float, b: float, Di: float, t_days: float) -> float:
    """Arps hyperbolic decline. Returns rate at time t."""
    if t_days <= 0:
        return qi
    return qi / (1 + b * Di * t_days) ** (1 / b)

def add_noise(value: float, noise_pct: float, rng: np.random.Generator) -> float:
    """Add gaussian noise proportional to value."""
    sigma = abs(value) * noise_pct
    return float(value + rng.normal(0, sigma))

# ─────────────────────────────────────────────
# WELL STATE MACHINE
# States: PRODUCING, SHUTDOWN, FLOWBACK, IDLE
# ─────────────────────────────────────────────
class WellState:
    def __init__(self, well_cfg: dict, rng: np.random.Generator):
        self.well_id = well_cfg["well_id"]
        self.first_prod = datetime.fromisoformat(well_cfg["first_production"]).replace(tzinfo=timezone.utc)
        self.lateral_m = well_cfg["lateral_length_m"]
        self.stages = well_cfg["stages"]
        self.rng = rng

        # Decline curve params (slightly different per well)
        self.qi_oil  = rng.uniform(60, 120)   # m³/day initial oil rate
        self.qi_gas  = self.qi_oil * rng.uniform(300, 600)  # initial GOR
        self.b       = rng.uniform(1.3, 1.8)
        self.Di      = rng.uniform(0.008, 0.015)

        # ESP params
        self.nominal_freq = rng.uniform(50, 60)

        self.state = "IDLE"
        self.shutdown_end: datetime | None = None
        self._shutdown_reason: str = ""

    def maybe_trigger_event(self, ts: datetime) -> None:
        """Random event triggers (shutdowns, alarms)."""
        if self.state == "PRODUCING":
            r = self.rng.random()
            if r < 0.0003:    # ~0.03% per minute → ~1 event per ~2.3 days
                duration_h = self.rng.uniform(2, 24)
                self.state = "SHUTDOWN"
                self.shutdown_end = ts + timedelta(hours=duration_h)
                self._shutdown_reason = self.rng.choice([
                    "HIGH_WHP", "ESP_GAS_LOCK", "SAND_PRODUCTION",
                    "PLANNED_MAINTENANCE", "WELL_TEST"
                ])
        elif self.state == "SHUTDOWN":
            if self.shutdown_end and ts >= self.shutdown_end:
                self.state = "PRODUCING"
                self._shutdown_reason = ""

    def get_signals(self, ts: datetime) -> dict:
        """Return a dict of all OT signals for this timestamp."""
        t_days = max(0, (ts - self.first_prod).total_seconds() / 86400)

        if ts < self.first_prod:
            self.state = "IDLE"
        elif self.state == "IDLE":
            self.state = "PRODUCING"

        self.maybe_trigger_event(ts)

        is_producing = self.state == "PRODUCING"
        factor = 1.0 if is_producing else 0.0

        # Core rates from decline curve
        oil  = hyperbolic_decline(self.qi_oil, self.b, self.Di, t_days) * factor
        gor  = min(800, SIGNAL_RANGES["gor_m3m3"]["min"] + t_days * 0.3)  # GOR creep over time
        gas  = oil * gor / 1000  # Mm³/day
        wc   = min(0.45, 0.02 + t_days * 0.0003)  # watercut creep
        water = oil * wc / (1 - wc) if wc < 1 else 0

        # Pressure model (simplified: WHP follows production)
        whp  = (30 + oil * 1.2) * factor + self.rng.uniform(-2, 2)
        chp  = whp * 0.45 + self.rng.uniform(-1, 1)
        downhole = 200 + oil * 1.8 + gas * 0.5

        # ESP
        freq  = (self.nominal_freq + oil * 0.08) * factor if is_producing else 0
        curr  = (45 + freq * 0.9 + self.rng.uniform(-2, 2)) * factor if is_producing else 0

        # Flowline temp (lags production changes)
        temp  = (55 + oil * 0.25 + gas * 0.05) * factor if is_producing else 20

        # Choke (open proportionally to rate, randomize slightly)
        choke = min(100, 20 + oil * 0.65) * factor if is_producing else 0

        def n(v, key): return add_noise(v, SIGNAL_RANGES[key]["noise_pct"], self.rng)

        return {
            "timestamp":          ts.isoformat(),
            "well_id":            self.well_id,
            "pad_id":             PAD_CONFIG["pad_id"],
            "state":              self.state,
            "shutdown_reason":    self._shutdown_reason,
            "t_days_online":      round(t_days, 2),
            "whp_bar":            round(n(whp,  "whp_bar"),  2),
            "chp_bar":            round(n(chp,  "chp_bar"),  2),
            "flowline_temp_c":    round(n(temp, "flowline_temp_c"), 2),
            "oil_rate_m3d":       round(max(0, n(oil,  "oil_rate_m3d")),  2),
            "gas_rate_mm3d":      round(max(0, n(gas,  "gas_rate_mm3d")), 3),
            "water_rate_m3d":     round(max(0, n(water,"water_rate_m3d")),2),
            "esp_current_a":      round(max(0, n(curr, "esp_current_a")), 2),
            "esp_freq_hz":        round(max(0, n(freq, "esp_freq_hz")),   2),
            "choke_pct":          round(max(0, min(100, n(choke,"choke_pct"))), 1),
            "downhole_pres_bar":  round(n(downhole,"downhole_pres_bar"), 2),
            "gor_m3m3":           round(gor, 1),
            "watercut_frac":      round(wc, 4),
        }

# ─────────────────────────────────────────────
# MAIN GENERATOR
# ─────────────────────────────────────────────
def generate_dataset(
    start: datetime,
    end: datetime,
    freq_minutes: int = 1,
    output_dir: Path = Path("../data/raw"),
    upload_s3: bool = False,
    s3_bucket: str = "vaca-muerta-raw",
    s3_endpoint: str = "http://localhost:4566",
) -> pd.DataFrame:

    rng = np.random.default_rng(seed=42)
    wells = [WellState(w, np.random.default_rng(seed=i+10)) for i, w in enumerate(PAD_CONFIG["wells"])]

    timestamps = pd.date_range(start=start, end=end, freq=f"{freq_minutes}min", tz="UTC")
    records = []

    console.print(f"\n[bold cyan]Vaca Muerta Simulator[/bold cyan]")
    console.print(f"  Pad:    {PAD_CONFIG['pad_id']} ({len(wells)} wells)")
    console.print(f"  Period: {start.date()} → {end.date()}")
    console.print(f"  Freq:   {freq_minutes} min  ({len(timestamps):,} timestamps × {len(wells)} wells = {len(timestamps)*len(wells):,} records)\n")

    for ts in track(timestamps, description="Generating..."):
        for well in wells:
            records.append(well.get_signals(ts.to_pydatetime()))

    df = pd.DataFrame(records)
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df["date"] = df["timestamp"].dt.date  # partition key

    # Save local Parquet (partitioned by date)
    output_dir.mkdir(parents=True, exist_ok=True)
    for date, group in df.groupby("date"):
        date_str = str(date)
        part_path = output_dir / f"date={date_str}"
        part_path.mkdir(exist_ok=True)
        filepath = part_path / "data.parquet"
        group.drop(columns=["date"]).to_parquet(filepath, index=False, engine="pyarrow")

    total_files = len(df["date"].unique())
    console.print(f"\n[green]✓ Saved {len(df):,} records → {total_files} Parquet files in {output_dir}[/green]")

    # Upload to S3 (LocalStack or real AWS)
    if upload_s3:
        console.print(f"\n[yellow]Uploading to s3://{s3_bucket} ...[/yellow]")
        s3 = boto3.client(
            "s3",
            endpoint_url=s3_endpoint,
            region_name="us-east-1",
            aws_access_key_id="test",
            aws_secret_access_key="test",
        )
        uploaded = 0
        for date, group in df.groupby("date"):
            date_str = str(date)
            local_file = output_dir / f"date={date_str}" / "data.parquet"
            s3_key = f"wells/pad=PAD-LLL-01/date={date_str}/data.parquet"
            s3.upload_file(str(local_file), s3_bucket, s3_key)
            uploaded += 1
        console.print(f"[green]✓ Uploaded {uploaded} Parquet files to s3://{s3_bucket}[/green]")

    return df


if __name__ == "__main__":
    # Generamos 90 días de histórico a 1 minuto
    START = datetime(2024, 4, 1, 0, 0, 0, tzinfo=timezone.utc)
    END   = datetime(2024, 6, 30, 23, 59, 0, tzinfo=timezone.utc)

    df = generate_dataset(
        start=START,
        end=END,
        freq_minutes=1,
        output_dir=Path("../data/raw"),
        upload_s3=True,
        s3_bucket="vaca-muerta-raw",
        s3_endpoint="http://localhost:4566",
    )

    # Preview
    console.print("\n[bold]Sample (LLL-001, first 3 rows):[/bold]")
    preview = df[df["well_id"] == "LLL-001"].head(3)
    for _, row in preview.iterrows():
        console.print(f"  {row['timestamp']}  oil={row['oil_rate_m3d']} m³/d  "
                      f"whp={row['whp_bar']} bar  esp={row['esp_freq_hz']} Hz  state={row['state']}")
