"""Event state machines: well-level, plant-level, and ESD (plant ESD)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import StrEnum
from typing import Optional

import numpy as np


class WellEvent(StrEnum):
    IDLE = "IDLE"
    FLOWBACK = "FLOWBACK"
    PRODUCING = "PRODUCING"
    GAS_LOCK = "GAS_LOCK"
    SAND_PLUG = "SAND_PLUG"
    HIGH_WHP_ALARM = "HIGH_WHP_ALARM"
    HIGH_VIBRATION = "HIGH_VIBRATION"
    SHUTDOWN = "SHUTDOWN"


class PlantEvent(StrEnum):
    NORMAL = "NORMAL"
    HIGH_SEP_LEVEL = "HIGH_SEP_LEVEL"
    LOW_TEG_CIRC = "LOW_TEG_CIRC"
    HYDRATE_FORMATION = "HYDRATE_FORMATION"
    PROPANE_LOW_PRESS = "PROPANE_LOW_PRESS"
    COMP_SURGE = "COMP_SURGE"
    COMP_HIGH_VIB = "COMP_HIGH_VIB"


class ESDReason(StrEnum):
    FIRE_GAS_HIGH = "FIRE_GAS_HIGH"
    HIGH_H2S = "HIGH_H2S"
    HIGH_HIGH_PRESSURE = "HIGH_HIGH_PRESSURE"
    LOW_LOW_LEVEL = "LOW_LOW_LEVEL"
    HIGH_HIGH_TEMP = "HIGH_HIGH_TEMP"
    POWER_FAILURE = "POWER_FAILURE"
    INSTRUMENT_AIR_LOSS = "INSTRUMENT_AIR_LOSS"
    EXTERNAL_TRIP = "EXTERNAL_TRIP"
    PLANNED_MAINTENANCE = "PLANNED_MAINTENANCE"


class ESDPhase(StrEnum):
    INACTIVE = "INACTIVE"
    TRIP = "TRIP"                       # T+0s, ESD valves to fail-safe
    DEPRESSURE = "DEPRESSURE"           # T+0-60s, plant inventory to flare
    COMPRESSOR_TRIP = "COMPRESSOR_TRIP" # T+0-2min, anti-surge open, then SD
    UTILITIES_DOWN = "UTILITIES_DOWN"   # T+0-5min, hot oil + propane trip
    HOLD = "HOLD"                       # T+5min until recovery_start, pilots stay lit
    RECOVERY = "RECOVERY"               # 30-90 min ramp-up


# Phase boundary offsets from esd start_ts
_ESD_BOUNDARIES = [
    (timedelta(seconds=0),  ESDPhase.TRIP),
    (timedelta(seconds=30), ESDPhase.DEPRESSURE),
    (timedelta(minutes=2),  ESDPhase.COMPRESSOR_TRIP),
    (timedelta(minutes=5),  ESDPhase.UTILITIES_DOWN),
    (timedelta(minutes=20), ESDPhase.HOLD),     # flare HP spike lasts 10-20 min per spec
]


@dataclass
class ESDState:
    active: bool = False
    reason: Optional[ESDReason] = None
    start_ts: Optional[datetime] = None
    end_ts: Optional[datetime] = None          # planned recovery start
    recovery_duration: timedelta = timedelta(minutes=60)

    def phase(self, ts: datetime) -> ESDPhase:
        if not self.active or self.start_ts is None:
            return ESDPhase.INACTIVE
        if ts < self.start_ts:                           # scheduled but not yet fired
            return ESDPhase.INACTIVE
        if self.end_ts is not None and ts >= self.end_ts:
            elapsed_recovery = ts - self.end_ts
            if elapsed_recovery >= self.recovery_duration:
                return ESDPhase.INACTIVE
            return ESDPhase.RECOVERY
        elapsed = ts - self.start_ts
        current = ESDPhase.HOLD
        for delta, ph in _ESD_BOUNDARIES:
            if elapsed >= delta:
                current = ph
            else:
                break
        return current

    def is_shutdown(self, ts: datetime) -> bool:
        ph = self.phase(ts)
        return ph not in (ESDPhase.INACTIVE, ESDPhase.RECOVERY)

    def recovery_progress(self, ts: datetime) -> float:
        """0.0 → 1.0 across the recovery window. Returns 1.0 when fully recovered."""
        if self.end_ts is None or ts < self.end_ts:
            return 0.0
        return min(1.0, (ts - self.end_ts).total_seconds() / self.recovery_duration.total_seconds())


@dataclass
class WellOverride:
    """A scheduled forced event for a specific well (used by --inject-gas-lock)."""
    event: WellEvent
    start_ts: datetime
    end_ts: datetime


@dataclass
class EventBus:
    """Central event coordinator.  Wells, plant, and utilities all read state from here."""
    esd: ESDState = field(default_factory=ESDState)
    well_overrides: dict[str, list[WellOverride]] = field(default_factory=dict)

    def schedule_esd(self, ts: datetime, reason: ESDReason, duration_h: float) -> None:
        self.esd = ESDState(
            active=True,
            reason=reason,
            start_ts=ts,
            end_ts=ts + timedelta(hours=duration_h),
        )

    def inject_well_event(self, well_id: str, ts: datetime, event: WellEvent,
                          duration_h: float) -> None:
        self.well_overrides.setdefault(well_id, []).append(
            WellOverride(event=event, start_ts=ts, end_ts=ts + timedelta(hours=duration_h))
        )

    def active_well_override(self, well_id: str, ts: datetime) -> Optional[WellEvent]:
        for ov in self.well_overrides.get(well_id, []):
            if ov.start_ts <= ts < ov.end_ts:
                return ov.event
        return None

    def tick(self, ts: datetime) -> None:
        """Advance time-based state. Currently ESDState.phase() is computed on demand,
        so nothing to do here besides expiring overrides (handled lazily in active_well_override)."""
        if self.esd.active and self.esd.end_ts is not None:
            recovery_done = ts >= self.esd.end_ts + self.esd.recovery_duration
            if recovery_done:
                self.esd = ESDState()  # clear


class WellStateMachine:
    """Transitions a single well between WellEvent states.
    Inputs: timestamp, signals dict (read by plant for triggers), event bus.
    Output: the current WellEvent (which dictates whether well produces this tick)."""

    def __init__(self, well_id: str, first_production: datetime, rng: np.random.Generator):
        self.well_id = well_id
        self.first_production = first_production
        self.rng = rng
        self.state = WellEvent.IDLE
        self.state_until: Optional[datetime] = None
        self.shutdown_reason: str = ""

    def transition(self, ts: datetime, bus: EventBus) -> WellEvent:
        # 1. ESD broadcast → all wells shut down (trip → end of recovery)
        if bus.esd.is_shutdown(ts):
            self.state = WellEvent.SHUTDOWN
            self.shutdown_reason = f"ESD:{bus.esd.reason.value if bus.esd.reason else ''}"
            return self.state

        # 2. Injected event override
        forced = bus.active_well_override(self.well_id, ts)
        if forced is not None:
            self.state = forced
            self.shutdown_reason = f"INJECTED:{forced.value}"
            return self.state

        # 3. Lifecycle gating
        if ts < self.first_production:
            self.state = WellEvent.IDLE
            self.shutdown_reason = ""
            return self.state

        t_days = (ts - self.first_production).total_seconds() / 86400.0
        in_flowback = t_days < 30.0

        # 4. Expire timed states first
        if self.state_until is not None and ts >= self.state_until:
            self.state_until = None
            self.shutdown_reason = ""
            self.state = WellEvent.FLOWBACK if in_flowback else WellEvent.PRODUCING

        # 5. From IDLE → FLOWBACK or PRODUCING once first_production reached
        if self.state == WellEvent.IDLE:
            self.state = WellEvent.FLOWBACK if in_flowback else WellEvent.PRODUCING

        # 6. From FLOWBACK → PRODUCING once 30d passed
        if self.state == WellEvent.FLOWBACK and not in_flowback:
            self.state = WellEvent.PRODUCING

        # 7. Random events while producing
        if self.state in (WellEvent.PRODUCING, WellEvent.FLOWBACK):
            r = self.rng.random()
            # Probabilities tuned for ~one event per well every few days at 1-5 min tick
            if r < 0.00002:                          # GAS_LOCK ~0.02%/min spec § 5.1
                self.state = WellEvent.GAS_LOCK
                self.state_until = ts + timedelta(hours=float(self.rng.uniform(1.0, 6.0)))
                self.shutdown_reason = "ESP_GAS_LOCK"
            elif r < 0.00004:
                self.state = WellEvent.SAND_PLUG
                self.state_until = ts + timedelta(hours=float(self.rng.uniform(4.0, 24.0)))
                self.shutdown_reason = "SAND_PRODUCTION"
            elif r < 0.00006:
                self.state = WellEvent.HIGH_VIBRATION
                self.state_until = ts + timedelta(hours=float(self.rng.uniform(1.0, 4.0)))
                self.shutdown_reason = "ESP_HIGH_VIBRATION"
            elif r < 0.00008:
                self.state = WellEvent.SHUTDOWN
                self.state_until = ts + timedelta(hours=float(self.rng.uniform(2.0, 24.0)))
                self.shutdown_reason = self.rng.choice(["PLANNED_MAINTENANCE", "WELL_TEST"])

        return self.state

    def is_producing(self) -> bool:
        return self.state in (WellEvent.FLOWBACK, WellEvent.PRODUCING)

    def production_factor(self) -> float:
        """How much of nominal rate flows. 0 for shut-in, 1 for normal, partial for impairments."""
        match self.state:
            case WellEvent.PRODUCING:
                return 1.0
            case WellEvent.FLOWBACK:
                return 0.6
            case WellEvent.GAS_LOCK:
                return 0.0                # ESP can't lift
            case WellEvent.SAND_PLUG:
                return 0.5
            case WellEvent.HIGH_VIBRATION:
                return 0.85
            case _:
                return 0.0
