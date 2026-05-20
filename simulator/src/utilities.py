"""Layer 3 — utilities: hot oil, instrument air, flare/antorcha.
One flattened record per timestamp with all §4 ISA tags."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

import numpy as np

from . import physics
from .config import PAD_ID, SIGNAL_RANGES
from .events import EventBus, ESDPhase


def _noisy(value: float, tag: str, rng: np.random.Generator,
           lo: Optional[float] = None, hi: Optional[float] = None) -> float:
    cfg = SIGNAL_RANGES[tag]
    noisy = physics.add_noise(value, cfg["noise"], rng)
    lo = cfg["min"] if lo is None else lo
    hi = cfg["max"] if hi is None else hi
    return round(physics.clip(noisy, lo, hi), 3)


class Utilities:
    """Hot oil + instrument air + flare.  Stateful (level drifts, KO drum filling)."""

    def __init__(self, rng: np.random.Generator):
        self.rng = rng

        self.lt_ia_accum = 75.0
        self.lt_ko_drum = 12.0
        self.zt_fuel_valve = 55.0

    def step(self, plant_state: dict, ts: datetime, bus: EventBus) -> dict:
        esd_phase = bus.esd.phase(ts)
        esd_active = bus.esd.is_shutdown(ts)
        esd_reason = bus.esd.reason.value if (esd_active and bus.esd.reason) else ""

        # ── §4.1 HOT OIL ─────────────────────────────────────────
        if esd_phase in (ESDPhase.UTILITIES_DOWN, ESDPhase.HOLD):
            # heater shut down — supply T decays
            supply_T = 130.0
            return_T = 120.0
            ft_hotoil = 5.0
            stack_T = 160.0
            o2_stack = 18.0           # cold heater → atmospheric O2 in stack
            fuel_valve = 5.0
        elif esd_phase == ESDPhase.RECOVERY:
            frac = bus.esd.recovery_progress(ts)
            supply_T = 130.0 + (260.0 - 130.0) * frac
            return_T = 120.0 + (200.0 - 120.0) * frac
            ft_hotoil = 5.0 + 50.0 * frac
            stack_T = 160.0 + 170.0 * frac
            o2_stack = 18.0 - 14.0 * frac
            fuel_valve = 5.0 + 50.0 * frac
        else:
            supply_T = SIGNAL_RANGES["TT_HOTOIL_SUPPLY"]["sp"] + self.rng.normal(0, 3)
            return_T = 200.0 + self.rng.normal(0, 4)
            ft_hotoil = 55.0 + self.rng.normal(0, 5)
            stack_T = 330.0 + self.rng.normal(0, 10)
            o2_stack = 4.0 + self.rng.normal(0, 0.4)
            fuel_valve = self.zt_fuel_valve + self.rng.normal(0, 2)
            self.zt_fuel_valve = physics.clip(fuel_valve, 20.0, 90.0)

        pt_hotoil = 4.5 + self.rng.normal(0, 0.15)

        # ── §4.2 INSTRUMENT AIR ─────────────────────────────────
        if esd_reason == "INSTRUMENT_AIR_LOSS":
            pt_ia = 3.0 + self.rng.normal(0, 0.2)
            dewpoint_ia = -10.0
            self.lt_ia_accum = max(10.0, self.lt_ia_accum - 0.5)
        else:
            pt_ia = SIGNAL_RANGES["PT_IA_HEADER"]["sp"] + self.rng.normal(0, 0.05)
            dewpoint_ia = -50.0 + self.rng.normal(0, 2.0)
            self.lt_ia_accum = physics.clip(
                self.lt_ia_accum + self.rng.normal(0, 0.5), 50.0, 90.0,
            )

        # ── §4.3 FLARE / ANTORCHA ───────────────────────────────
        # HP flare spike per spec §5.3 step 3 — 100-200 Mm³/d for 10-20 min during DEPRESSURE → COMPRESSOR_TRIP → UTILITIES_DOWN
        if esd_phase in (ESDPhase.TRIP, ESDPhase.DEPRESSURE, ESDPhase.COMPRESSOR_TRIP):
            ft_flare_hp = float(self.rng.uniform(120.0, 200.0))
            ft_flare_lp = float(self.rng.uniform(20.0, 40.0))
            smoke = float(self.rng.uniform(15.0, 30.0))
            self.lt_ko_drum = min(80.0, self.lt_ko_drum + 4.0)
        elif esd_phase in (ESDPhase.UTILITIES_DOWN, ESDPhase.HOLD):
            ft_flare_hp = float(self.rng.uniform(5.0, 25.0))   # tail-off
            ft_flare_lp = float(self.rng.uniform(5.0, 15.0))
            smoke = float(self.rng.uniform(2.0, 10.0))
            self.lt_ko_drum = max(5.0, self.lt_ko_drum - 0.2)
        else:
            ft_flare_hp = max(0.0, self.rng.normal(0.5, 0.3))
            ft_flare_lp = max(0.0, self.rng.normal(1.0, 0.4))
            smoke = max(0.0, self.rng.normal(0.5, 0.3))
            self.lt_ko_drum = physics.clip(
                self.lt_ko_drum + self.rng.normal(0, 0.3), 5.0, 50.0,
            )

        pilot_T = 750.0 + self.rng.normal(0, 25)    # always > 500 per spec §5.3 step 6
        pt_ko = 0.15 + self.rng.normal(0, 0.03)

        return {
            "timestamp": ts,
            "pad_id": PAD_ID,
            "esd_phase": esd_phase.value,
            "esd_reason": esd_reason,
            # Hot oil
            "TT_HOTOIL_SUPPLY": _noisy(supply_T, "TT_HOTOIL_SUPPLY", self.rng, lo=100.0, hi=300.0),
            "TT_HOTOIL_RETURN": _noisy(return_T, "TT_HOTOIL_RETURN", self.rng, lo=80.0, hi=240.0),
            "PT_HOTOIL":        _noisy(pt_hotoil, "PT_HOTOIL", self.rng, lo=0.0),
            "FT_HOTOIL":        _noisy(ft_hotoil, "FT_HOTOIL", self.rng, lo=0.0),
            "TT_HEATER_STACK":  _noisy(stack_T, "TT_HEATER_STACK", self.rng, lo=100.0),
            "AI_O2_STACK":      _noisy(o2_stack, "AI_O2_STACK", self.rng, lo=1.0, hi=21.0),
            "ZT_FUEL_VALVE":    _noisy(fuel_valve, "ZT_FUEL_VALVE", self.rng, lo=0.0),
            # Instrument air
            "PT_IA_HEADER":     _noisy(pt_ia, "PT_IA_HEADER", self.rng, lo=0.0),
            "TT_IA_DEWPOINT":   round(dewpoint_ia, 1),
            "LT_IA_ACCUM":      round(self.lt_ia_accum, 2),
            # Flare
            "FT_FLARE_HP":      round(ft_flare_hp, 2),
            "FT_FLARE_LP":      round(ft_flare_lp, 2),
            "TT_FLARE_PILOT":   _noisy(pilot_T, "TT_FLARE_PILOT", self.rng, lo=500.0),
            "PT_KO_DRUM":       _noisy(pt_ko, "PT_KO_DRUM", self.rng, lo=0.0),
            "LT_KO_DRUM":       round(self.lt_ko_drum, 2),
            "QI_FLARE_SMOKE":   _noisy(smoke, "QI_FLARE_SMOKE", self.rng, lo=0.0),
        }
