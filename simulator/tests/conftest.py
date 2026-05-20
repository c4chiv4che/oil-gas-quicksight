"""Shared fixtures for the simulator pytest suite."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pytest

from src.cli import RunConfig
from src.events import ESDReason
from src.quality import GasComposition


SEED = 42


@pytest.fixture
def rng() -> np.random.Generator:
    """Deterministic RNG for any test that needs one."""
    return np.random.default_rng(SEED)


@pytest.fixture
def start_ts() -> datetime:
    """Fixed UTC anchor for event/ESD tests so wall time never leaks in."""
    return datetime(2026, 4, 15, 14, 0, 0, tzinfo=timezone.utc)


@pytest.fixture
def vm_comp() -> GasComposition:
    """Sales-gas-side Vaca Muerta composition: lands inside NAG-602 PCS band
    (heavies already stripped by LTS in the real pipeline). Sums to exactly 100.0."""
    return GasComposition(
        c1=90.0, c2=6.0, c3=1.5, c4=0.3, c5_plus=0.05,
        co2=1.0, n2=1.15,
        h2s=2.0, h2o=50.0,
    )


@pytest.fixture
def wellhead_comp() -> GasComposition:
    """Raw wellhead composition (heavies still present). Used to exercise
    composition_shift and weighted_mix realistically. Sums to 100.0."""
    return GasComposition(
        c1=86.0, c2=8.0, c3=3.0, c4=1.0, c5_plus=0.5,
        co2=1.0, n2=0.5,
        h2s=2.0, h2o=250.0,
    )


@pytest.fixture
def tiny_run_cfg(tmp_path: Path) -> RunConfig:
    """A 2-day, 60-minute-tick RunConfig pointed at tmp_path. No upload, no injections."""
    start = datetime(2026, 4, 15, 0, 0, 0, tzinfo=timezone.utc)
    end = datetime(2026, 4, 17, 0, 0, 0, tzinfo=timezone.utc)  # 2 days
    return RunConfig(
        start=start,
        end=end,
        freq_minutes=60,
        layers=("wells", "plant", "utilities"),
        upload="none",
        output_dir=tmp_path,
        seed=SEED,
        inject_esd_at=None,
        esd_reason=ESDReason.EXTERNAL_TRIP,
        esd_duration_h=4.0,
        inject_gas_lock_well=None,
        inject_gas_lock_at=None,
        gas_lock_duration_h=3.0,
    )
