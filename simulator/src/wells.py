"""Layer 1 — horizontal shale wells with ESP lift.  Emits one record per well per tick."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional

import numpy as np

from . import physics, quality
from .config import PAD_ID, SIGNAL_RANGES, WELL_BASE_COMP, WELL_GEOMETRY
from .events import EventBus, WellEvent, WellStateMachine
from .quality import GasComposition


@dataclass
class InletStream:
    """Plant-facing aggregate of all currently producing wells."""
    total_gas_mm3d: float
    total_oil_m3d: float
    total_water_m3d: float
    composition: GasComposition
    T_in_C: float
    P_in_bar: float


class Well:
    """Single horizontal shale well, ESP-lifted."""

    def __init__(self, well_id: str, first_production: datetime, rng: np.random.Generator):
        cfg = WELL_GEOMETRY[well_id]
        self.well_id = well_id
        self.first_production = first_production
        self.lateral_m = cfg["lateral_m"]
        self.stages = cfg["stages"]
        self.rng = rng

        # Decline params — Arps hyperbolic, slightly different per well
        self.qi_oil = float(rng.uniform(80.0, 120.0))     # m³/d initial
        self.base_gor = float(rng.uniform(280.0, 400.0))  # m³/m³ baseline
        self.b = float(rng.uniform(1.3, 1.8))
        self.Di = float(rng.uniform(0.008, 0.015))

        # ESP nominals
        self.nominal_freq = float(rng.uniform(50.0, 60.0))

        # Baseline composition (deterministic from config)
        self.base_comp = GasComposition.from_dict(WELL_BASE_COMP[well_id])

        # Currently-produced rates — cached so WellPad.aggregate can read after step()
        self.last_oil = 0.0
        self.last_gas = 0.0
        self.last_water = 0.0
        self.last_comp = self.base_comp
        self.last_T = 25.0
        self.last_P = 30.0

        self.sm = WellStateMachine(well_id, first_production, rng)

    # ── Internal helpers ────────────────────────────────────────────
    def _signals_idle(self, ts: datetime) -> dict:
        zeros = {tag: 0.0 for tag in (
            "FT_OIL", "FT_GAS", "FT_WATER",
            "IT_ESP", "SI_ESP", "ZT_CHOKE",
        )}
        return {
            "timestamp": ts,
            "pad_id": PAD_ID,
            "well_id": self.well_id,
            "well_state": self.sm.state.value,
            "shutdown_reason": self.sm.shutdown_reason,
            "t_days_online": round(max(0.0, (ts - self.first_production).total_seconds() / 86400.0), 3),
            "WHP": 0.0, "CHP": 0.0, "TT_FLOW": 20.0,
            **zeros,
            "PT_DOWNHOLE": 200.0, "AI_GOR": self.base_gor, "AI_WCUT": 0.0,
            "AI_C1": self.base_comp.c1, "AI_C2": self.base_comp.c2,
            "AI_C3": self.base_comp.c3, "AI_C4": self.base_comp.c4,
            "AI_C5_PLUS": self.base_comp.c5_plus,
            "AI_CO2": self.base_comp.co2, "AI_N2": self.base_comp.n2,
            "AI_H2S": self.base_comp.h2s, "AI_H2O": self.base_comp.h2o,
            "AI_SAND": 0.0, "VT_ESP": 0.0, "TT_ESP_OIL": 25.0,
            "corrosion_risk": 0.0, "hydrate_risk": 0.0,
        }

    def step(self, ts: datetime, bus: EventBus) -> dict:
        state = self.sm.transition(ts, bus)
        t_days = max(0.0, (ts - self.first_production).total_seconds() / 86400.0)

        # IDLE / SHUTDOWN / GAS_LOCK → no production
        if state == WellEvent.IDLE or self.sm.production_factor() == 0.0:
            self.last_oil = self.last_gas = self.last_water = 0.0
            self.last_T = 20.0
            self.last_P = 0.0
            rec = self._signals_idle(ts)
            rec["WHP"] = round(physics.add_noise(15.0, 0.01, self.rng), 2)  # idle WHP from buildup
            return rec

        factor = self.sm.production_factor()
        in_flowback = state == WellEvent.FLOWBACK

        # ── Rates ─────────────────────────────────────────────────
        oil = physics.arps_hyperbolic(self.qi_oil, self.b, self.Di, t_days) * factor
        gor = physics.gor_creep(self.base_gor, t_days)
        gas = oil * gor / 1000.0                                    # Mm³/d
        wc = physics.watercut_creep(0.02, t_days, flowback=in_flowback)
        water = oil * wc / max(1e-6, 1.0 - wc)

        # ── Pressures ─────────────────────────────────────────────
        choke = physics.clip(
            (20.0 + oil * 0.65) * (1.2 if in_flowback else 1.0),
            5.0, 100.0,
        )
        whp = physics.whp_from_oil_choke(oil, choke)
        chp = whp * 0.45
        downhole = physics.downhole_from_whp(whp, oil, gas)

        # ── ESP & temperature ─────────────────────────────────────
        freq = self.nominal_freq + oil * 0.08
        curr = 45.0 + freq * 0.9 + (8.0 if state == WellEvent.HIGH_VIBRATION else 0.0)
        flowline_T = 55.0 + oil * 0.25 + gas * 0.05
        esp_oil_T = 70.0 + curr * 0.15 + (15.0 if state == WellEvent.HIGH_VIBRATION else 0.0)
        vib = (
            1.0 if state == WellEvent.PRODUCING
            else 1.8 if state == WellEvent.FLOWBACK
            else 5.5 if state == WellEvent.HIGH_VIBRATION
            else 1.2
        )

        # ── Sand ──────────────────────────────────────────────────
        sand = (
            12.0 if in_flowback
            else 35.0 if state == WellEvent.SAND_PLUG
            else 3.0
        )

        # ── Composition ──────────────────────────────────────────
        comp = quality.composition_shift(self.base_comp, gor, t_days)
        # Mild noise on composition each tick
        comp_noisy = comp  # noise added per-field at output

        # ── Risk indices ──────────────────────────────────────────
        corr = physics.corrosion_risk(comp.h2s, comp.h2o, flowline_T)
        hydr = physics.hydrate_risk(flowline_T, whp, comp.h2o, comp.c1_fraction())

        # cache for aggregate()
        self.last_oil = max(0.0, oil)
        self.last_gas = max(0.0, gas)
        self.last_water = max(0.0, water)
        self.last_comp = comp_noisy
        self.last_T = flowline_T
        self.last_P = whp

        def n(v: float, tag: str, lo: Optional[float] = None, hi: Optional[float] = None) -> float:
            cfg = SIGNAL_RANGES[tag]
            noisy = physics.add_noise(v, cfg["noise"], self.rng)
            lo = cfg["min"] if lo is None else lo
            hi = cfg["max"] if hi is None else hi
            return round(physics.clip(noisy, lo, hi), 3)

        return {
            "timestamp": ts,
            "pad_id": PAD_ID,
            "well_id": self.well_id,
            "well_state": state.value,
            "shutdown_reason": self.sm.shutdown_reason,
            "t_days_online": round(t_days, 3),
            "WHP": n(whp, "WHP"),
            "CHP": n(chp, "CHP"),
            "TT_FLOW": n(flowline_T, "TT_FLOW"),
            "FT_OIL": n(oil, "FT_OIL", lo=0.0),
            "FT_GAS": n(gas, "FT_GAS", lo=0.0),
            "FT_WATER": n(water, "FT_WATER", lo=0.0),
            "IT_ESP": n(curr, "IT_ESP"),
            "SI_ESP": n(freq, "SI_ESP"),
            "ZT_CHOKE": n(choke, "ZT_CHOKE"),
            "PT_DOWNHOLE": n(downhole, "PT_DOWNHOLE"),
            "AI_GOR": round(gor, 1),
            "AI_WCUT": round(wc, 4),
            "AI_C1": round(comp_noisy.c1, 2),
            "AI_C2": round(comp_noisy.c2, 2),
            "AI_C3": round(comp_noisy.c3, 2),
            "AI_C4": round(comp_noisy.c4, 2),
            "AI_C5_PLUS": round(comp_noisy.c5_plus, 2),
            "AI_CO2": round(comp_noisy.co2, 2),
            "AI_N2": round(comp_noisy.n2, 2),
            "AI_H2S": round(comp_noisy.h2s, 2),
            "AI_H2O": round(comp_noisy.h2o, 1),
            "AI_SAND": n(sand, "AI_SAND", lo=0.0),
            "VT_ESP": n(vib, "VT_ESP", lo=0.0),
            "TT_ESP_OIL": n(esp_oil_T, "TT_ESP_OIL"),
            "corrosion_risk": round(corr, 4),
            "hydrate_risk": round(hydr, 4),
        }


class WellPad:
    """Holds the 4 horizontal wells of the pad and aggregates them for the plant."""

    def __init__(self, wells: list[Well]):
        self.wells = wells

    def step(self, ts: datetime, bus: EventBus) -> list[dict]:
        return [w.step(ts, bus) for w in self.wells]

    def aggregate(self) -> InletStream:
        """Sum flows + flow-weighted composition.  Reads cached last_* from each well."""
        streams = [(w.last_comp, w.last_gas) for w in self.wells if w.last_gas > 0]
        if streams:
            comp = quality.weighted_mix(streams)
            avg_T = sum(w.last_T * w.last_gas for w in self.wells) / max(1e-6, sum(w.last_gas for w in self.wells))
            avg_P = sum(w.last_P * w.last_gas for w in self.wells) / max(1e-6, sum(w.last_gas for w in self.wells))
        else:
            comp = self.wells[0].base_comp
            avg_T = 25.0
            avg_P = 0.0

        return InletStream(
            total_gas_mm3d=sum(w.last_gas for w in self.wells),
            total_oil_m3d=sum(w.last_oil for w in self.wells),
            total_water_m3d=sum(w.last_water for w in self.wells),
            composition=comp,
            T_in_C=avg_T,
            P_in_bar=avg_P,
        )
