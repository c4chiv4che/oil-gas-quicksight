"""Main entry point.  Orchestrates the three layers and writes Parquet output.

Usage:
    uv run python -m src.simulator                                   # smoke-test defaults
    uv run python -m src.simulator --days 180 --freq 1               # full volume
    uv run python -m src.simulator --upload local
"""

from __future__ import annotations

import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
from rich.console import Console
from rich.progress import (
    BarColumn, MofNCompleteColumn, Progress, TextColumn, TimeElapsedColumn, TimeRemainingColumn,
)

from .cli import RunConfig, app
from .config import PAD_ID, WELL_IDS, WELL_OFFSETS_DAYS
from .events import EventBus, WellEvent
from .output import render_summary, upload_layer_s3, write_layer_parquet
from .plant import Plant
from .utilities import Utilities
from .wells import Well, WellPad

console = Console()


def _build_pad(start: datetime, rng: np.random.Generator) -> WellPad:
    """Construct 4 wells with first_production offsets relative to CLI start."""
    wells: list[Well] = []
    for wid in WELL_IDS:
        first_prod = start + timedelta(days=WELL_OFFSETS_DAYS[wid])
        # Independent RNG per well so well composition stays reproducible regardless of run length
        wrng = np.random.default_rng(int(rng.integers(0, 2**31 - 1)))
        wells.append(Well(wid, first_prod, wrng))
    return WellPad(wells)


def run(cfg: RunConfig) -> dict[str, pd.DataFrame]:
    rng = np.random.default_rng(cfg.seed)
    bus = EventBus()

    # Apply injections
    if cfg.inject_esd_at is not None:
        bus.schedule_esd(cfg.inject_esd_at, cfg.esd_reason, cfg.esd_duration_h)
    if cfg.inject_gas_lock_well and cfg.inject_gas_lock_at:
        bus.inject_well_event(
            cfg.inject_gas_lock_well,
            cfg.inject_gas_lock_at,
            WellEvent.GAS_LOCK,
            cfg.gas_lock_duration_h,
        )

    pad = _build_pad(cfg.start, rng)
    plant = Plant(np.random.default_rng(int(rng.integers(0, 2**31 - 1))))
    utils = Utilities(np.random.default_rng(int(rng.integers(0, 2**31 - 1))))

    timestamps = pd.date_range(cfg.start, cfg.end, freq=f"{cfg.freq_minutes}min", tz="UTC", inclusive="left")

    # ── Banner ───────────────────────────────────────────────────────
    console.print(f"\n[bold cyan]Vaca Muerta Simulator v2[/bold cyan]")
    console.print(f"  Pad:     {PAD_ID}  ({len(pad.wells)} wells)")
    console.print(f"  Period:  {cfg.start.isoformat()} → {cfg.end.isoformat()}  ({cfg.freq_minutes}-min ticks)")
    console.print(f"  Layers:  {', '.join(cfg.layers)}")
    console.print(f"  Output:  {cfg.output_dir}")
    console.print(f"  Upload:  {cfg.upload}")
    if cfg.inject_esd_at:
        console.print(f"  [yellow]ESD injected[/yellow]: {cfg.inject_esd_at.isoformat()}  reason={cfg.esd_reason.value}  duration={cfg.esd_duration_h}h")
    if cfg.inject_gas_lock_well:
        console.print(f"  [yellow]GAS_LOCK injected[/yellow]: {cfg.inject_gas_lock_well} @ {cfg.inject_gas_lock_at}")
    console.print()

    well_recs: list[dict] = []
    plant_recs: list[dict] = []
    util_recs: list[dict] = []

    do_wells = "wells" in cfg.layers
    do_plant = "plant" in cfg.layers
    do_utils = "utilities" in cfg.layers

    t0 = time.perf_counter()
    with Progress(
        TextColumn("[progress.description]{task.description}"),
        BarColumn(bar_width=40),
        MofNCompleteColumn(),
        TextColumn("•"),
        TimeElapsedColumn(),
        TextColumn("•"),
        TimeRemainingColumn(),
        console=console,
    ) as progress:
        task = progress.add_task("Generating", total=len(timestamps))
        for ts_pd in timestamps:
            ts = ts_pd.to_pydatetime()
            bus.tick(ts)
            # Wells always run (their state feeds plant aggregate even if layer not exported)
            w_recs = pad.step(ts, bus)
            if do_wells:
                well_recs.extend(w_recs)

            if do_plant or do_utils:
                inlet = pad.aggregate()
                p_rec = plant.step(inlet, ts, bus)
                if do_plant:
                    plant_recs.append(p_rec)
                if do_utils:
                    util_recs.append(utils.step(p_rec, ts, bus))

            progress.update(task, advance=1)
    elapsed = time.perf_counter() - t0

    # ── Build DataFrames ────────────────────────────────────────────
    layer_dfs: dict[str, pd.DataFrame] = {
        "wells": pd.DataFrame(well_recs),
        "plant": pd.DataFrame(plant_recs),
        "utilities": pd.DataFrame(util_recs),
    }

    # ── Write Parquet ───────────────────────────────────────────────
    cfg.output_dir.mkdir(parents=True, exist_ok=True)
    for layer, df in layer_dfs.items():
        n = write_layer_parquet(df, layer, cfg.output_dir)
        if n > 0:
            console.print(f"[green]✓[/green] {layer}: wrote {n} Parquet date-partitions")

    # ── Upload (optional) ───────────────────────────────────────────
    if cfg.upload != "none":
        for layer, df in layer_dfs.items():
            if df.empty:
                continue
            n = upload_layer_s3(cfg.output_dir, layer, cfg.upload)
            console.print(f"[green]✓[/green] uploaded {n} files for layer '{layer}' → s3 ({cfg.upload})")

    # ── Summary ─────────────────────────────────────────────────────
    render_summary(layer_dfs, elapsed, cfg.output_dir)

    return layer_dfs


if __name__ == "__main__":
    app()
