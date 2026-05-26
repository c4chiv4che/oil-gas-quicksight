"""End-to-end integration tests. Run the simulator in-process at small scale."""

from __future__ import annotations

import io
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import pytest
from rich.console import Console

from src import output as output_module
from src import simulator as simulator_module
from src.cli import RunConfig
from src.events import ESDPhase, ESDReason
from src.simulator import run

# ── Helpers ───────────────────────────────────────────────────────────────────

@pytest.fixture
def silent_console(monkeypatch: pytest.MonkeyPatch) -> None:
    """Redirect Rich output (banner + Progress + summary table) into a buffer
    so the CI log isn't littered with half-rendered progress frames."""
    sink = Console(file=io.StringIO(), force_terminal=False, force_jupyter=False,
                   record=False, quiet=False, width=120)
    monkeypatch.setattr(simulator_module, "console", sink)
    monkeypatch.setattr(output_module, "console", sink)


def _make_cfg(tmp_path: Path, *, start: datetime, hours: int, freq_minutes: int,
              inject_esd_at: datetime | None = None,
              esd_duration_h: float = 2.0,
              inject_gas_lock_well: str | None = None,
              inject_gas_lock_at: datetime | None = None,
              gas_lock_duration_h: float = 3.0) -> RunConfig:
    return RunConfig(
        start=start,
        end=start + timedelta(hours=hours),
        freq_minutes=freq_minutes,
        layers=("wells", "plant", "utilities"),
        upload="none",
        output_dir=tmp_path,
        seed=42,
        inject_esd_at=inject_esd_at,
        esd_reason=ESDReason.EXTERNAL_TRIP,
        esd_duration_h=esd_duration_h,
        inject_gas_lock_well=inject_gas_lock_well,
        inject_gas_lock_at=inject_gas_lock_at,
        gas_lock_duration_h=gas_lock_duration_h,
    )


# ── Baseline smoke test ───────────────────────────────────────────────────────

class TestSmokeRun:
    @pytest.fixture
    def layer_dfs(self, tiny_run_cfg: RunConfig, silent_console: None) -> dict[str, pd.DataFrame]:
        return run(tiny_run_cfg)

    def test_three_layers_present(self, layer_dfs: dict[str, pd.DataFrame]) -> None:
        assert set(layer_dfs.keys()) == {"wells", "plant", "utilities"}
        for layer, df in layer_dfs.items():
            assert not df.empty, f"layer {layer} produced no rows"

    def test_expected_row_counts(self, layer_dfs: dict[str, pd.DataFrame]) -> None:
        # 2 days × 24 ticks at 60-min freq = 48 ticks
        assert len(layer_dfs["plant"]) == 48
        assert len(layer_dfs["utilities"]) == 48
        # 4 wells × 48 ticks = 192
        assert len(layer_dfs["wells"]) == 48 * 4

    def test_esd_columns_only_in_plant_and_utilities(self, layer_dfs: dict[str, pd.DataFrame]) -> None:
        # ESD phase/reason live on the plant and utilities layer, not wells
        assert "esd_phase" in layer_dfs["plant"].columns
        assert "esd_reason" in layer_dfs["plant"].columns
        assert "esd_phase" in layer_dfs["utilities"].columns
        assert "esd_reason" in layer_dfs["utilities"].columns
        assert "esd_phase" not in layer_dfs["wells"].columns
        assert "esd_reason" not in layer_dfs["wells"].columns

    def test_well_columns_present(self, layer_dfs: dict[str, pd.DataFrame]) -> None:
        wells = layer_dfs["wells"]
        # ISA tags from spec §2.1/2.2/2.3 — sample, not exhaustive
        for col in ("WHP", "CHP", "FT_OIL", "FT_GAS", "FT_WATER", "ZT_CHOKE",
                    "AI_GOR", "AI_WCUT", "AI_C1", "AI_H2S", "AI_H2O",
                    "well_state", "well_id", "pad_id"):
            assert col in wells.columns, f"wells missing {col}"

    def test_plant_columns_present(self, layer_dfs: dict[str, pd.DataFrame]) -> None:
        plant = layer_dfs["plant"]
        for col in ("PT_INLET", "FT_INLET_GAS", "FT_INLET_LIQ",
                    "PT_SEP", "TT_CONTACTOR", "FT_TEG_CIRC", "AI_TEG_PURITY",
                    "PT_COMP_SUCT", "SI_COMP", "AI_PCS", "AI_WOBBE", "AI_DENSITY"):
            assert col in plant.columns, f"plant missing {col}"

    def test_utilities_columns_present(self, layer_dfs: dict[str, pd.DataFrame]) -> None:
        utils = layer_dfs["utilities"]
        for col in ("TT_HOTOIL_SUPPLY", "PT_IA_HEADER", "FT_FLARE_HP",
                    "TT_FLARE_PILOT", "LT_KO_DRUM"):
            assert col in utils.columns, f"utilities missing {col}"

    def test_no_nan_in_critical_columns(self, layer_dfs: dict[str, pd.DataFrame]) -> None:
        critical = {
            "wells":     ["FT_OIL", "FT_GAS", "WHP", "well_state"],
            "plant":     ["FT_INLET_GAS", "AI_PCS", "AI_WOBBE", "esd_phase"],
            "utilities": ["TT_FLARE_PILOT", "PT_IA_HEADER", "esd_phase"],
        }
        for layer, cols in critical.items():
            df = layer_dfs[layer]
            for c in cols:
                assert df[c].notna().all(), f"{layer}.{c} has NaN"

    def test_timestamps_monotonic(self, layer_dfs: dict[str, pd.DataFrame]) -> None:
        for layer in ("plant", "utilities"):
            ts = pd.to_datetime(layer_dfs[layer]["timestamp"])
            assert ts.is_monotonic_increasing, f"{layer} timestamps not monotonic"
        # wells: per-well_id should be monotonic
        wells = layer_dfs["wells"]
        for wid, g in wells.groupby("well_id"):
            ts = pd.to_datetime(g["timestamp"])
            assert ts.is_monotonic_increasing, f"wells[{wid}] timestamps not monotonic"

    def test_no_esd_means_inactive_phase(self, layer_dfs: dict[str, pd.DataFrame]) -> None:
        # No injection in tiny_run_cfg → phase should be INACTIVE throughout
        plant = layer_dfs["plant"]
        assert set(plant["esd_phase"].unique()) == {ESDPhase.INACTIVE.value}
        assert set(plant["esd_reason"].unique()) == {""}

    def test_parquet_files_written(self, layer_dfs: dict[str, pd.DataFrame],
                                    tiny_run_cfg: RunConfig) -> None:
        # output_dir/{layer}/pad=PAD-LLL-01/date=YYYY-MM-DD/data.parquet
        for layer in ("wells", "plant", "utilities"):
            files = list((tiny_run_cfg.output_dir / layer).rglob("data.parquet"))
            assert files, f"no parquet files for {layer}"


# ── ESD injection cycle ───────────────────────────────────────────────────────

class TestEsdInjection:
    @pytest.fixture
    def esd_run(self, tmp_path: Path, silent_console: None) -> dict[str, pd.DataFrame]:
        # 6-hour window at 1-min freq so every ESD phase is sampled at least once.
        # ESD at +1h, duration 2h, recovery default 60min → fully recovered by +4h.
        start = datetime(2026, 4, 15, 0, 0, 0, tzinfo=timezone.utc)
        cfg = _make_cfg(
            tmp_path, start=start, hours=6, freq_minutes=1,
            inject_esd_at=start + timedelta(hours=1),
            esd_duration_h=2.0,
        )
        return run(cfg)

    def test_all_phases_appear(self, esd_run: dict[str, pd.DataFrame]) -> None:
        phases = set(esd_run["plant"]["esd_phase"].unique())
        # At 1-min freq we should see every transition.
        for ph in ("INACTIVE", "TRIP", "DEPRESSURE", "COMPRESSOR_TRIP",
                   "UTILITIES_DOWN", "HOLD", "RECOVERY"):
            assert ph in phases, f"phase {ph} did not appear (got {phases})"

    def test_phase_ordering(self, esd_run: dict[str, pd.DataFrame]) -> None:
        # Phases must appear in this temporal order — pull first occurrence ts of each
        plant = esd_run["plant"].copy()
        plant["timestamp"] = pd.to_datetime(plant["timestamp"])
        order = ["TRIP", "DEPRESSURE", "COMPRESSOR_TRIP",
                 "UTILITIES_DOWN", "HOLD", "RECOVERY"]
        first_seen = []
        for ph in order:
            sub = plant[plant["esd_phase"] == ph]
            assert not sub.empty, f"phase {ph} missing"
            first_seen.append(sub["timestamp"].min())
        for a, b in zip(first_seen, first_seen[1:]):
            assert a < b, f"phase order broken: {a} not < {b}"

    def test_esd_reason_set_during_active(self, esd_run: dict[str, pd.DataFrame]) -> None:
        plant = esd_run["plant"]
        active_mask = plant["esd_phase"].isin([
            "TRIP", "DEPRESSURE", "COMPRESSOR_TRIP", "UTILITIES_DOWN", "HOLD",
        ])
        assert active_mask.any()
        assert (plant.loc[active_mask, "esd_reason"] == "EXTERNAL_TRIP").all()

    def test_flare_hp_spikes_during_depressure_window(self, esd_run: dict[str, pd.DataFrame]) -> None:
        utils = esd_run["utilities"]
        # FT_FLARE_HP per spec §5.3 step 3 should spike to 120-200 Mm³/d during
        # TRIP/DEPRESSURE/COMPRESSOR_TRIP
        spike_mask = utils["esd_phase"].isin(["TRIP", "DEPRESSURE", "COMPRESSOR_TRIP"])
        baseline_mask = utils["esd_phase"] == "INACTIVE"
        # Baseline is near zero noise (~0.5 mean), spike window 120-200
        spike_avg = utils.loc[spike_mask, "FT_FLARE_HP"].mean()
        base_avg = utils.loc[baseline_mask, "FT_FLARE_HP"].mean()
        assert spike_avg > 100.0
        assert base_avg < 5.0

    def test_compressor_speed_zero_during_active(self, esd_run: dict[str, pd.DataFrame]) -> None:
        plant = esd_run["plant"]
        active_mask = plant["esd_phase"].isin([
            "TRIP", "DEPRESSURE", "COMPRESSOR_TRIP", "UTILITIES_DOWN", "HOLD",
        ])
        # Compressor explicitly tripped during active ESD → SI_COMP set to 0
        assert (plant.loc[active_mask, "SI_COMP"] == 0.0).all()


# ── Gas-lock isolation ────────────────────────────────────────────────────────

class TestGasLockInjection:
    @pytest.fixture
    def gaslock_run(self, tmp_path: Path, silent_console: None) -> dict[str, pd.DataFrame]:
        # 24-hour window at 60-min freq.  Inject GAS_LOCK on LLL-002 (plateau well,
        # safely PRODUCING normally) at +6h for 4h.
        start = datetime(2026, 4, 15, 0, 0, 0, tzinfo=timezone.utc)
        cfg = _make_cfg(
            tmp_path, start=start, hours=24, freq_minutes=60,
            inject_gas_lock_well="LLL-002",
            inject_gas_lock_at=start + timedelta(hours=6),
            gas_lock_duration_h=4.0,
        )
        return run(cfg)

    def test_gas_lock_only_on_target_well(self, gaslock_run: dict[str, pd.DataFrame]) -> None:
        wells = gaslock_run["wells"].copy()
        wells["timestamp"] = pd.to_datetime(wells["timestamp"])
        start = wells["timestamp"].min()
        window = (wells["timestamp"] >= start + timedelta(hours=6)) & \
                 (wells["timestamp"] <  start + timedelta(hours=10))

        # Target well shows GAS_LOCK inside the window
        target = wells[(wells["well_id"] == "LLL-002") & window]
        assert not target.empty
        assert (target["well_state"] == "GAS_LOCK").all()

        # Other wells must NOT be in GAS_LOCK in the same window
        others = wells[(wells["well_id"] != "LLL-002") & window]
        assert (others["well_state"] != "GAS_LOCK").all()

    def test_gas_lock_zeros_oil(self, gaslock_run: dict[str, pd.DataFrame]) -> None:
        wells = gaslock_run["wells"]
        gl_rows = wells[(wells["well_id"] == "LLL-002") &
                        (wells["well_state"] == "GAS_LOCK")]
        assert not gl_rows.empty
        assert (gl_rows["FT_OIL"] == 0.0).all()
        assert (gl_rows["FT_GAS"] == 0.0).all()
        assert (gl_rows["FT_WATER"] == 0.0).all()

    def test_gas_lock_recovers_after_window(self, gaslock_run: dict[str, pd.DataFrame]) -> None:
        # Injected GAS_LOCK arms state_until = override.end_ts in
        # WellStateMachine.transition(), so once the override window closes
        # the well returns to FLOWBACK / PRODUCING on the next tick.
        wells = gaslock_run["wells"].copy()
        wells["timestamp"] = pd.to_datetime(wells["timestamp"])
        start = wells["timestamp"].min()
        # Window: +6h → +10h. At +11h the well must no longer be GAS_LOCK.
        post = wells[(wells["well_id"] == "LLL-002") &
                     (wells["timestamp"] >= start + timedelta(hours=11))]
        assert not post.empty
        assert (post["well_state"] != "GAS_LOCK").all()
        assert (post["well_state"].isin({"FLOWBACK", "PRODUCING"})).all()

    def test_other_layers_unaffected_by_well_event(self, gaslock_run: dict[str, pd.DataFrame]) -> None:
        # A single-well gas lock should NOT trigger ESD on plant/utilities
        plant = gaslock_run["plant"]
        utils = gaslock_run["utilities"]
        assert set(plant["esd_phase"].unique()) == {"INACTIVE"}
        assert set(utils["esd_phase"].unique()) == {"INACTIVE"}
