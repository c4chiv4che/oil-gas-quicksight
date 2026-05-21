"""Typer CLI for the Vaca Muerta simulator v2."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import typer

from .config import DEFAULTS
from .events import ESDReason, WellEvent


app = typer.Typer(add_completion=False, help="Vaca Muerta shale ops simulator v2 (wells + plant + utilities).")


@dataclass
class RunConfig:
    start: datetime
    end: datetime
    freq_minutes: int
    layers: tuple[str, ...]
    upload: str
    output_dir: Path
    seed: int
    inject_esd_at: Optional[datetime]
    esd_reason: ESDReason
    esd_duration_h: float
    inject_gas_lock_well: Optional[str]
    inject_gas_lock_at: Optional[datetime]
    gas_lock_duration_h: float
    stream: bool = False
    no_local: bool = False
    profile: str = "oil-gas-dev"


def _parse_iso_utc(s: str) -> datetime:
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


@app.command()
def main(
    days: int = typer.Option(DEFAULTS["days"], help="Simulation length in days."),
    freq: int = typer.Option(DEFAULTS["freq"], help="Sampling frequency in minutes."),
    start: Optional[str] = typer.Option(None, help="ISO start datetime UTC. Default: now - days."),
    layers: str = typer.Option(DEFAULTS["layers"], help="Comma-separated subset of wells,plant,utilities."),
    upload: str = typer.Option(DEFAULTS["upload"], help="none | local | aws."),
    output_dir: Path = typer.Option(Path(DEFAULTS["output_dir"]), help="Local output root for Parquet."),
    seed: int = typer.Option(DEFAULTS["seed"], help="RNG seed."),
    inject_esd: Optional[str] = typer.Option(
        None, help='ISO datetime to trigger a plant ESD, e.g. "2026-04-15T14:00:00".',
    ),
    esd_reason: ESDReason = typer.Option(
        ESDReason.EXTERNAL_TRIP, help="ESD cause for --inject-esd.",
    ),
    esd_duration_h: float = typer.Option(
        DEFAULTS["esd_duration_h"], help="ESD duration before recovery starts.",
    ),
    inject_gas_lock: Optional[str] = typer.Option(
        None,
        help='Force a GAS_LOCK on one well.  Format "WELL_ID:ISO_TS"  '
             'e.g. "LLL-002:2026-04-10T08:00:00".',
    ),
    gas_lock_duration_h: float = typer.Option(3.0, help="Duration of injected gas-lock."),
    stream: bool = typer.Option(
        False, "--stream/--no-stream",
        help="Emit records to Kinesis for every layer in --layers. "
             "Stream names are derived per layer as vaca-muerta-<layer>-stream.",
    ),
    no_local: bool = typer.Option(
        False, "--no-local",
        help="Skip local Parquet for any streamed layer (Firehose lands it in S3). Requires --stream.",
    ),
    profile: str = typer.Option("oil-gas-dev", help="AWS profile for boto3 session (Kinesis only)."),
) -> None:
    """Run the simulator and write three Parquet datasets partitioned by date."""

    # ── Parse layers ────────────────────────────────────────────────
    layers_t = tuple(s.strip() for s in layers.split(",") if s.strip())
    valid = {"wells", "plant", "utilities"}
    bad = set(layers_t) - valid
    if bad:
        raise typer.BadParameter(f"unknown layer(s): {bad}.  Valid: {valid}")

    # ── Parse time window ───────────────────────────────────────────
    if start:
        start_dt = _parse_iso_utc(start)
    else:
        start_dt = (datetime.now(tz=timezone.utc) - timedelta(days=days)).replace(microsecond=0)
    end_dt = start_dt + timedelta(days=days)

    # ── Parse injects ───────────────────────────────────────────────
    esd_at = _parse_iso_utc(inject_esd) if inject_esd else None
    gas_lock_well: Optional[str] = None
    gas_lock_at: Optional[datetime] = None
    if inject_gas_lock:
        if ":" not in inject_gas_lock:
            raise typer.BadParameter(
                'inject-gas-lock format must be "WELL_ID:ISO_TS" (e.g. "LLL-002:2026-04-10T08:00:00")'
            )
        well_part, ts_part = inject_gas_lock.split(":", 1)
        gas_lock_well = well_part.strip()
        gas_lock_at = _parse_iso_utc(ts_part.strip())

    if upload not in ("none", "local", "aws"):
        raise typer.BadParameter("upload must be one of: none, local, aws")

    # ── Validate stream flags ───────────────────────────────────────
    if no_local and not stream:
        raise typer.BadParameter("--no-local requires --stream")

    cfg = RunConfig(
        start=start_dt,
        end=end_dt,
        freq_minutes=freq,
        layers=layers_t,
        upload=upload,
        output_dir=output_dir,
        seed=seed,
        inject_esd_at=esd_at,
        esd_reason=esd_reason,
        esd_duration_h=esd_duration_h,
        inject_gas_lock_well=gas_lock_well,
        inject_gas_lock_at=gas_lock_at,
        gas_lock_duration_h=gas_lock_duration_h,
        stream=stream,
        no_local=no_local,
        profile=profile,
    )

    # Import lazily so --help is instant
    from . import simulator as sim_main
    sim_main.run(cfg)
