"""Tests for src/events.py — ESD state machine + EventBus + WellStateMachine."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from src.events import (
    _ESD_BOUNDARIES,
    ESDPhase,
    ESDReason,
    ESDState,
    EventBus,
    WellEvent,
    WellStateMachine,
)


# ── Enum regression guards ────────────────────────────────────────────────────
# These pin the string values so a rename or accidental edit breaks the suite
# loudly instead of silently breaking Athena queries that join on these strings.

class TestEnumStability:
    def test_esd_reason_values(self) -> None:
        assert {r.value for r in ESDReason} == {
            "FIRE_GAS_HIGH", "HIGH_H2S", "HIGH_HIGH_PRESSURE", "LOW_LOW_LEVEL",
            "HIGH_HIGH_TEMP", "POWER_FAILURE", "INSTRUMENT_AIR_LOSS",
            "EXTERNAL_TRIP", "PLANNED_MAINTENANCE",
        }

    def test_esd_phase_values(self) -> None:
        assert {p.value for p in ESDPhase} == {
            "INACTIVE", "TRIP", "DEPRESSURE", "COMPRESSOR_TRIP",
            "UTILITIES_DOWN", "HOLD", "RECOVERY",
        }

    def test_well_event_values(self) -> None:
        assert {e.value for e in WellEvent} == {
            "IDLE", "FLOWBACK", "PRODUCING", "GAS_LOCK", "SAND_PLUG",
            "HIGH_WHP_ALARM", "HIGH_VIBRATION", "SHUTDOWN",
        }


# ── ESDState.phase() — boundary table ─────────────────────────────────────────
# Pulled from the real _ESD_BOUNDARIES rather than hardcoded so a change
# in source is reflected here automatically.

def _phase_for_elapsed(elapsed: timedelta) -> ESDPhase:
    """What phase ESDState.phase() should report for a given elapsed time
    inside the active window, derived from _ESD_BOUNDARIES."""
    current = ESDPhase.HOLD
    for delta, ph in _ESD_BOUNDARIES:
        if elapsed >= delta:
            current = ph
        else:
            break
    return current


class TestESDStatePhase:
    @pytest.fixture
    def active_esd(self, start_ts: datetime) -> ESDState:
        return ESDState(
            active=True,
            reason=ESDReason.EXTERNAL_TRIP,
            start_ts=start_ts,
            end_ts=start_ts + timedelta(hours=4),
            recovery_duration=timedelta(hours=1),
        )

    def test_inactive_when_not_active(self, start_ts: datetime) -> None:
        s = ESDState()
        assert s.phase(start_ts) == ESDPhase.INACTIVE

    def test_inactive_before_start_ts(self, active_esd: ESDState, start_ts: datetime) -> None:
        assert active_esd.phase(start_ts - timedelta(seconds=1)) == ESDPhase.INACTIVE

    @pytest.mark.parametrize(
        "elapsed",
        [
            timedelta(seconds=0),
            timedelta(seconds=10),
            timedelta(seconds=29),
            timedelta(seconds=30),
            timedelta(seconds=60),
            timedelta(seconds=119),
            timedelta(minutes=2),
            timedelta(minutes=3),
            timedelta(minutes=4, seconds=59),
            timedelta(minutes=5),
            timedelta(minutes=10),
            timedelta(minutes=19),
            timedelta(minutes=19, seconds=59),
            timedelta(minutes=20),
            timedelta(minutes=30),
            timedelta(hours=2),
        ],
    )
    def test_phase_matches_boundaries(self, active_esd: ESDState,
                                      start_ts: datetime, elapsed: timedelta) -> None:
        expected = _phase_for_elapsed(elapsed)
        got = active_esd.phase(start_ts + elapsed)
        assert got == expected, f"at +{elapsed}: expected {expected}, got {got}"

    def test_recovery_after_end_ts(self, active_esd: ESDState) -> None:
        # exactly at end_ts → RECOVERY
        assert active_esd.phase(active_esd.end_ts) == ESDPhase.RECOVERY
        # halfway through recovery
        mid = active_esd.end_ts + active_esd.recovery_duration / 2
        assert active_esd.phase(mid) == ESDPhase.RECOVERY

    def test_inactive_after_recovery(self, active_esd: ESDState) -> None:
        done = active_esd.end_ts + active_esd.recovery_duration
        assert active_esd.phase(done) == ESDPhase.INACTIVE
        later = done + timedelta(hours=1)
        assert active_esd.phase(later) == ESDPhase.INACTIVE


class TestESDStateShutdownAndRecovery:
    @pytest.fixture
    def active_esd(self, start_ts: datetime) -> ESDState:
        return ESDState(
            active=True,
            reason=ESDReason.HIGH_HIGH_PRESSURE,
            start_ts=start_ts,
            end_ts=start_ts + timedelta(hours=2),
            recovery_duration=timedelta(minutes=60),
        )

    @pytest.mark.parametrize(
        "elapsed,is_sd",
        [
            (timedelta(seconds=0),  True),    # TRIP
            (timedelta(seconds=30), True),    # DEPRESSURE
            (timedelta(minutes=2),  True),    # COMPRESSOR_TRIP
            (timedelta(minutes=5),  True),    # UTILITIES_DOWN
            (timedelta(minutes=20), True),    # HOLD
            (timedelta(hours=1),    True),    # still HOLD
        ],
    )
    def test_is_shutdown_in_active_window(self, active_esd: ESDState,
                                          start_ts: datetime,
                                          elapsed: timedelta, is_sd: bool) -> None:
        assert active_esd.is_shutdown(start_ts + elapsed) is is_sd

    def test_is_not_shutdown_in_recovery_or_after(self, active_esd: ESDState) -> None:
        # at end_ts → RECOVERY → not a shutdown
        assert active_esd.is_shutdown(active_esd.end_ts) is False
        # after full recovery → INACTIVE → not a shutdown
        done = active_esd.end_ts + active_esd.recovery_duration
        assert active_esd.is_shutdown(done) is False

    def test_recovery_progress_ramps_0_to_1(self, active_esd: ESDState) -> None:
        # before end_ts: always 0
        assert active_esd.recovery_progress(active_esd.start_ts) == 0.0
        assert active_esd.recovery_progress(active_esd.end_ts - timedelta(seconds=1)) == 0.0
        # at end_ts: 0
        assert active_esd.recovery_progress(active_esd.end_ts) == 0.0
        # midpoint: ~0.5
        mid = active_esd.end_ts + active_esd.recovery_duration / 2
        assert active_esd.recovery_progress(mid) == pytest.approx(0.5, abs=1e-6)
        # at done: clamps to 1.0
        done = active_esd.end_ts + active_esd.recovery_duration
        assert active_esd.recovery_progress(done) == 1.0
        # well past done: still 1.0
        later = done + timedelta(hours=10)
        assert active_esd.recovery_progress(later) == 1.0


# ── EventBus ──────────────────────────────────────────────────────────────────

class TestEventBus:
    def test_schedule_esd_sets_state(self, start_ts: datetime) -> None:
        bus = EventBus()
        bus.schedule_esd(start_ts, ESDReason.FIRE_GAS_HIGH, duration_h=4.0)
        assert bus.esd.active is True
        assert bus.esd.reason == ESDReason.FIRE_GAS_HIGH
        assert bus.esd.start_ts == start_ts
        assert bus.esd.end_ts == start_ts + timedelta(hours=4)

    def test_phase_progression_via_tick(self, start_ts: datetime) -> None:
        bus = EventBus()
        bus.schedule_esd(start_ts, ESDReason.EXTERNAL_TRIP, duration_h=1.0)
        # Phase queries match the _phase_for_elapsed table
        for elapsed in [timedelta(seconds=0), timedelta(seconds=30),
                        timedelta(minutes=2), timedelta(minutes=5),
                        timedelta(minutes=20)]:
            ts = start_ts + elapsed
            bus.tick(ts)
            assert bus.esd.phase(ts) == _phase_for_elapsed(elapsed)

    def test_tick_clears_after_recovery(self, start_ts: datetime) -> None:
        bus = EventBus()
        bus.schedule_esd(start_ts, ESDReason.EXTERNAL_TRIP, duration_h=1.0)
        assert bus.esd.active is True
        # advance well past end_ts + recovery_duration (default 60min)
        far_future = start_ts + timedelta(hours=3)
        bus.tick(far_future)
        # tick() should have cleared the ESDState back to a fresh one
        assert bus.esd.active is False
        assert bus.esd.reason is None

    def test_inject_well_event_in_window(self, start_ts: datetime) -> None:
        bus = EventBus()
        bus.inject_well_event("LLL-002", start_ts, WellEvent.GAS_LOCK, duration_h=3.0)
        assert bus.active_well_override("LLL-002", start_ts) == WellEvent.GAS_LOCK
        assert bus.active_well_override("LLL-002", start_ts + timedelta(hours=2)) == WellEvent.GAS_LOCK

    def test_inject_well_event_outside_window(self, start_ts: datetime) -> None:
        bus = EventBus()
        bus.inject_well_event("LLL-002", start_ts, WellEvent.GAS_LOCK, duration_h=3.0)
        assert bus.active_well_override("LLL-002", start_ts - timedelta(seconds=1)) is None
        # end_ts is exclusive per dataclass field (start_ts <= ts < end_ts)
        assert bus.active_well_override("LLL-002", start_ts + timedelta(hours=3)) is None

    def test_inject_isolated_to_target_well(self, start_ts: datetime) -> None:
        bus = EventBus()
        bus.inject_well_event("LLL-002", start_ts, WellEvent.GAS_LOCK, duration_h=3.0)
        assert bus.active_well_override("LLL-001", start_ts) is None
        assert bus.active_well_override("LLL-003", start_ts + timedelta(hours=1)) is None


# ── WellStateMachine ──────────────────────────────────────────────────────────

class TestWellStateMachine:
    def test_idle_before_first_production(self, start_ts: datetime) -> None:
        rng = np.random.default_rng(0)
        first_prod = start_ts + timedelta(days=10)
        sm = WellStateMachine("LLL-004", first_prod, rng)
        bus = EventBus()
        state = sm.transition(start_ts, bus)
        assert state == WellEvent.IDLE
        assert sm.production_factor() == 0.0

    def test_flowback_in_first_30_days(self, start_ts: datetime) -> None:
        rng = np.random.default_rng(0)
        first_prod = start_ts - timedelta(days=5)  # 5d into life
        sm = WellStateMachine("LLL-003", first_prod, rng)
        bus = EventBus()
        state = sm.transition(start_ts, bus)
        assert state == WellEvent.FLOWBACK
        assert sm.production_factor() == 0.6

    def test_producing_after_30_days(self, start_ts: datetime) -> None:
        rng = np.random.default_rng(0)
        first_prod = start_ts - timedelta(days=60)  # mature
        sm = WellStateMachine("LLL-001", first_prod, rng)
        bus = EventBus()
        state = sm.transition(start_ts, bus)
        assert state == WellEvent.PRODUCING
        assert sm.production_factor() == 1.0

    def test_flowback_to_producing_transition(self, start_ts: datetime) -> None:
        rng = np.random.default_rng(0)
        first_prod = start_ts  # day 0 of life
        sm = WellStateMachine("LLL-003", first_prod, rng)
        bus = EventBus()
        # Day 5 → FLOWBACK
        s1 = sm.transition(start_ts + timedelta(days=5), bus)
        assert s1 == WellEvent.FLOWBACK
        # Day 40 → PRODUCING
        s2 = sm.transition(start_ts + timedelta(days=40), bus)
        assert s2 == WellEvent.PRODUCING

    def test_esd_broadcast_forces_shutdown(self, start_ts: datetime) -> None:
        rng = np.random.default_rng(0)
        first_prod = start_ts - timedelta(days=60)
        sm = WellStateMachine("LLL-001", first_prod, rng)
        bus = EventBus()
        bus.schedule_esd(start_ts, ESDReason.HIGH_H2S, duration_h=2.0)
        state = sm.transition(start_ts + timedelta(minutes=1), bus)
        assert state == WellEvent.SHUTDOWN
        assert "ESD:HIGH_H2S" in sm.shutdown_reason

    def test_injected_event_overrides(self, start_ts: datetime) -> None:
        rng = np.random.default_rng(0)
        first_prod = start_ts - timedelta(days=60)
        sm = WellStateMachine("LLL-002", first_prod, rng)
        bus = EventBus()
        bus.inject_well_event("LLL-002", start_ts, WellEvent.GAS_LOCK, duration_h=2.0)
        state = sm.transition(start_ts + timedelta(minutes=1), bus)
        assert state == WellEvent.GAS_LOCK
        assert sm.production_factor() == 0.0

    def test_injected_event_does_not_leak_to_other_wells(self, start_ts: datetime) -> None:
        rng = np.random.default_rng(0)
        first_prod = start_ts - timedelta(days=60)
        sm = WellStateMachine("LLL-001", first_prod, rng)
        bus = EventBus()
        bus.inject_well_event("LLL-002", start_ts, WellEvent.GAS_LOCK, duration_h=2.0)
        state = sm.transition(start_ts + timedelta(minutes=1), bus)
        assert state == WellEvent.PRODUCING  # mature → producing, unaffected

    @pytest.mark.parametrize(
        "event,expected_factor",
        [
            (WellEvent.PRODUCING, 1.0),
            (WellEvent.FLOWBACK, 0.6),
            (WellEvent.GAS_LOCK, 0.0),
            (WellEvent.SAND_PLUG, 0.5),
            (WellEvent.HIGH_VIBRATION, 0.85),
            (WellEvent.SHUTDOWN, 0.0),
            (WellEvent.IDLE, 0.0),
            (WellEvent.HIGH_WHP_ALARM, 0.0),  # falls through to default → 0
        ],
    )
    def test_production_factor_table(self, event: WellEvent, expected_factor: float,
                                     start_ts: datetime) -> None:
        rng = np.random.default_rng(0)
        sm = WellStateMachine("LLL-001", start_ts, rng)
        sm.state = event
        assert sm.production_factor() == expected_factor

    def test_is_producing_only_for_producing_states(self, start_ts: datetime) -> None:
        rng = np.random.default_rng(0)
        sm = WellStateMachine("LLL-001", start_ts, rng)
        for ev in (WellEvent.PRODUCING, WellEvent.FLOWBACK):
            sm.state = ev
            assert sm.is_producing() is True
        for ev in (WellEvent.IDLE, WellEvent.GAS_LOCK, WellEvent.SHUTDOWN,
                   WellEvent.SAND_PLUG, WellEvent.HIGH_VIBRATION):
            sm.state = ev
            assert sm.is_producing() is False
