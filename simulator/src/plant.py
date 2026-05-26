"""Layer 2 — processing plant.  Manifold → Separator → TEG → LTS → Stabilizer → Compression → Fiscal.
One flattened record per timestamp with all §3 ISA tags."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

import numpy as np

from . import physics, quality
from .config import PAD_ID, SIGNAL_RANGES
from .events import ESDPhase, EventBus, PlantEvent
from .wells import InletStream


def _noisy(value: float, tag: str, rng: np.random.Generator,
           lo: Optional[float] = None, hi: Optional[float] = None) -> float:
    cfg = SIGNAL_RANGES[tag]
    noisy = physics.add_noise(value, cfg["noise"], rng)
    lo = cfg["min"] if lo is None else lo
    hi = cfg["max"] if hi is None else hi
    return round(physics.clip(noisy, lo, hi), 3)


class Plant:
    """Stateful plant model.  Holds drifting state vars (levels, TEG purity, etc.) tick to tick."""

    def __init__(self, rng: np.random.Generator):
        self.rng = rng

        # Levels (drift around setpoint with control action)
        self.lt_slug = 50.0
        self.lt_sep_oil = 50.0
        self.lt_sep_water = 45.0
        self.lt_teg_surge = 60.0
        self.lt_lts = 50.0
        self.lt_prop_acum = 60.0

        # TEG slow drift in purity
        self.teg_purity = 99.2

        # Compression
        self.comp_speed = 10000.0

        # Plant-level event flag
        self.plant_event = PlantEvent.NORMAL

    def _update_event(self, esd_phase: ESDPhase) -> None:
        """Pick a plant-level event flag from current state (priority order)."""
        if esd_phase not in (ESDPhase.INACTIVE, ESDPhase.RECOVERY):
            self.plant_event = PlantEvent.NORMAL  # ESD dominates; plant_event reset
            return
        if self.lt_sep_oil > 75:
            self.plant_event = PlantEvent.HIGH_SEP_LEVEL
        elif self.lt_lts < 20 or self.lt_lts > 85:
            self.plant_event = PlantEvent.HYDRATE_FORMATION
        else:
            self.plant_event = PlantEvent.NORMAL

    def step(self, inlet: InletStream, ts: datetime, bus: EventBus) -> dict:
        esd_phase = bus.esd.phase(ts)
        esd_active = bus.esd.is_shutdown(ts)
        recovery_frac = bus.esd.recovery_progress(ts) if esd_phase == ESDPhase.RECOVERY else 0.0

        # During ESD shutdown phases (TRIP/DEPRESSURE/COMPRESSOR_TRIP/UTILITIES_DOWN/HOLD)
        # inventory drops; almost no through-flow.
        if esd_active:
            flow_factor = 0.0
        elif esd_phase == ESDPhase.RECOVERY:
            flow_factor = recovery_frac        # 0 → 1 during recovery
        else:
            flow_factor = 1.0

        inlet_gas = inlet.total_gas_mm3d * flow_factor
        inlet_liq = (inlet.total_oil_m3d + inlet.total_water_m3d) * flow_factor

        # ── §3.1 INLET MANIFOLD + SLUG CATCHER ──────────────────────
        pt_inlet = SIGNAL_RANGES["PT_INLET"]["sp"] + (inlet_gas / 300.0 - 0.5) * 10.0
        tt_inlet = 35.0 + inlet.T_in_C * 0.2
        # slug catcher level: random walk around setpoint, gas surges raise it
        self.lt_slug = physics.clip(
            self.lt_slug + self.rng.normal(0, 0.8) + (inlet_liq - 80.0) * 0.002,
            10.0, 95.0,
        )

        # ── §3.2 3-PHASE SEPARATOR ──────────────────────────────────
        pt_sep = SIGNAL_RANGES["PT_SEP"]["sp"]
        tt_sep = 40.0 + tt_inlet * 0.1
        # oil level rises with liquid throughput, dump valve corrects at 60%
        self.lt_sep_oil = physics.clip(
            self.lt_sep_oil + self.rng.normal(0, 0.5)
            + (inlet_liq / 100.0 - 0.5) * 0.3
            - (1.0 if self.lt_sep_oil > 55 else 0.0),
            5.0, 90.0,
        )
        self.lt_sep_water = physics.clip(
            self.lt_sep_water + self.rng.normal(0, 0.5)
            + (inlet.total_water_m3d * flow_factor / 30.0 - 0.5) * 0.3
            - (1.0 if self.lt_sep_water > 50 else 0.0),
            5.0, 90.0,
        )
        pdt_sep = 100.0 + inlet_gas * 0.2

        # ── §3.3 TEG DEHYDRATION ────────────────────────────────────
        ft_teg_circ = 1200.0 + self.rng.normal(0, 30) - (0 if esd_phase == ESDPhase.INACTIVE else 400.0)
        tt_contactor = SIGNAL_RANGES["TT_CONTACTOR"]["sp"] + self.rng.normal(0, 0.5)
        pt_contactor = pt_sep * 6.0
        tt_reboiler = SIGNAL_RANGES["TT_REBOILER"]["sp"] + self.rng.normal(0, 0.8)
        # slow purity drift: degrades when reboiler under-temps or circulation low
        purity_drift = -0.005 + (0.01 if tt_reboiler > 199 else -0.01)
        self.teg_purity = physics.clip(self.teg_purity + purity_drift * 0.02, 98.0, 99.7)

        outlet_h2o = quality.teg_dehydrate(
            inlet.composition.h2o, max(0.0, ft_teg_circ), tt_contactor, self.teg_purity
        )
        dew_h2o = -8.0 - (self.teg_purity - 99.0) * 8.0 - (1200.0 - ft_teg_circ) / 200.0
        self.lt_teg_surge = physics.clip(
            self.lt_teg_surge + self.rng.normal(0, 0.4), 25.0, 85.0,
        )

        # ── §3.4 LTS / DEW POINT ────────────────────────────────────
        tt_gas_gas = 10.0 + inlet_gas / 50.0
        tt_chiller = SIGNAL_RANGES["TT_CHILLER"]["sp"] + self.rng.normal(0, 0.6)
        pt_lts = 50.0 + (pt_sep - 10.0) * 2.0
        tt_lts = tt_chiller + 1.0
        self.lt_lts = physics.clip(
            self.lt_lts + self.rng.normal(0, 0.5)
            + (inlet_liq / 200.0 - 0.3) * 0.2
            - (1.0 if self.lt_lts > 55 else 0.0),
            5.0, 90.0,
        )
        dew_hc = quality.lts_reduce_hc_dewpoint(15.0, dT=25.0 + self.rng.normal(0, 1.5))
        dew_hc = physics.clip(dew_hc, -15.0, -2.0)

        # ── §3.5 PROPANE REFRIGERATION ─────────────────────────────
        if esd_active:
            pt_prop_suct = 0.5
            pt_prop_disch = 8.0
            si_prop_comp = 0.0
            it_prop_comp = 0.0
        else:
            pt_prop_suct = 2.0 + self.rng.normal(0, 0.1)
            pt_prop_disch = 14.0 + self.rng.normal(0, 0.3)
            si_prop_comp = 3200.0 + inlet_gas * 1.0
            it_prop_comp = 140.0 + inlet_gas * 0.2
        tt_prop_suct = -18.0 + self.rng.normal(0, 1.0)
        tt_prop_disch = 90.0 + self.rng.normal(0, 3.0)
        vt_prop_comp = 1.2 + self.rng.normal(0, 0.3)
        self.lt_prop_acum = physics.clip(
            self.lt_prop_acum + self.rng.normal(0, 0.3), 30.0, 85.0,
        )

        # ── §3.6 STABILIZER ────────────────────────────────────────
        pt_stab = 7.5 + self.rng.normal(0, 0.2)
        tt_stab_top = 65.0 + self.rng.normal(0, 2.0)
        tt_stab_bot = 200.0 + self.rng.normal(0, 4.0)
        ft_cond_out = inlet.total_oil_m3d * flow_factor * 0.85   # losses in stabilization
        ai_rvp = 10.0 + (220.0 - tt_stab_bot) * 0.05            # higher bottom T → lower RVP

        # ── §3.7 CENTRIFUGAL COMPRESSION ───────────────────────────
        if esd_active:
            self.comp_speed = 0.0
            zt_antisurge = 100.0       # fully open during ESD
            ft_recycle = 0.0
            pt_comp_suct = 0.0
            pt_comp_disch = 0.0
            tt_comp_suct = 30.0
            tt_comp_disch = 30.0
            vt_comp = 0.0
        else:
            target_speed = 8000.0 + inlet_gas * 13.0
            self.comp_speed = physics.clip(target_speed, 8000.0, 12000.0)
            ratio = physics.centrifugal_ratio(self.comp_speed)
            pt_comp_suct = SIGNAL_RANGES["PT_COMP_SUCT"]["sp"]
            pt_comp_disch = pt_comp_suct * ratio
            tt_comp_suct = 40.0 + self.rng.normal(0, 1.5)
            tt_comp_disch = tt_comp_suct + 70.0 * (ratio - 1.0) / 0.083
            surge_line = 50.0
            zt_antisurge = physics.antisurge_position(inlet_gas, surge_line)
            ft_recycle = zt_antisurge / 100.0 * 30.0
            vt_comp = 1.5 + self.rng.normal(0, 0.4)

        # ── §3.8 FISCAL METERING ───────────────────────────────────
        # Sales gas is leaner than inlet — LTS condenses heavies, stabilizer recovers NGLs.
        # Recovery fractions (heavies dropped out into condensate, not sent to sales):
        #   C5+ ≈ 95% recovered, C4 ≈ 60%, C3 ≈ 30%, C2 ≈ 5%, C1 stays
        fiscal_comp = quality.GasComposition(
            c1=inlet.composition.c1,
            c2=inlet.composition.c2 * 0.75,    # ~25% C2 lost to chilling + leaks
            c3=inlet.composition.c3 * 0.45,
            c4=inlet.composition.c4 * 0.20,
            c5_plus=inlet.composition.c5_plus * 0.02,
            co2=inlet.composition.co2, n2=inlet.composition.n2,
            h2s=inlet.composition.h2s * 0.9,   # minimal change without amine
            h2o=outlet_h2o,
        ).normalize()

        pcs = fiscal_comp.pcs_kcal_m3()
        wobbe = fiscal_comp.wobbe_kcal_m3()
        density = fiscal_comp.relative_density()
        s_total = fiscal_comp.total_sulfur_mg_m3()

        # Update plant event flag based on freshly-computed levels
        self._update_event(esd_phase)

        return {
            "timestamp": ts,
            "pad_id": PAD_ID,
            "plant_event": self.plant_event.value,
            "esd_phase": esd_phase.value,
            "esd_reason": bus.esd.reason.value if (esd_active and bus.esd.reason) else "",
            # Inlet
            "PT_INLET":   _noisy(pt_inlet, "PT_INLET", self.rng),
            "TT_INLET":   _noisy(tt_inlet, "TT_INLET", self.rng),
            "LT_SLUG":    round(self.lt_slug, 2),
            "FT_INLET_GAS": _noisy(inlet_gas, "FT_INLET_GAS", self.rng, lo=0.0),
            "FT_INLET_LIQ": _noisy(inlet_liq, "FT_INLET_LIQ", self.rng, lo=0.0),
            # Separator
            "PT_SEP":     _noisy(pt_sep, "PT_SEP", self.rng),
            "TT_SEP":     _noisy(tt_sep, "TT_SEP", self.rng),
            "LT_SEP_OIL": round(self.lt_sep_oil, 2),
            "LT_SEP_WATER": round(self.lt_sep_water, 2),
            "PDT_SEP":    _noisy(pdt_sep, "PDT_SEP", self.rng),
            # TEG
            "TT_CONTACTOR":   _noisy(tt_contactor, "TT_CONTACTOR", self.rng),
            "PT_CONTACTOR":   _noisy(pt_contactor, "PT_CONTACTOR", self.rng),
            "FT_TEG_CIRC":    _noisy(ft_teg_circ, "FT_TEG_CIRC", self.rng, lo=0.0),
            "TT_REBOILER":    _noisy(tt_reboiler, "TT_REBOILER", self.rng),
            "AI_TEG_PURITY":  round(self.teg_purity, 3),
            "AI_DEWPOINT_H2O":_noisy(dew_h2o, "AI_DEWPOINT_H2O", self.rng),
            "LT_TEG_SURGE":   round(self.lt_teg_surge, 2),
            # LTS
            "TT_GAS_GAS":  _noisy(tt_gas_gas, "TT_GAS_GAS", self.rng),
            "TT_CHILLER":  _noisy(tt_chiller, "TT_CHILLER", self.rng),
            "PT_LTS":      _noisy(pt_lts, "PT_LTS", self.rng),
            "TT_LTS":      _noisy(tt_lts, "TT_LTS", self.rng),
            "LT_LTS":      round(self.lt_lts, 2),
            "AI_DEWPOINT_HC": round(dew_hc, 2),
            # Propane
            "PT_PROP_SUCT":  _noisy(pt_prop_suct, "PT_PROP_SUCT", self.rng, lo=0.0),
            "PT_PROP_DISCH": _noisy(pt_prop_disch, "PT_PROP_DISCH", self.rng, lo=0.0),
            "TT_PROP_SUCT":  _noisy(tt_prop_suct, "TT_PROP_SUCT", self.rng),
            "TT_PROP_DISCH": _noisy(tt_prop_disch, "TT_PROP_DISCH", self.rng, lo=20.0),
            "SI_PROP_COMP":  _noisy(si_prop_comp, "SI_PROP_COMP", self.rng, lo=0.0),
            "IT_PROP_COMP":  _noisy(it_prop_comp, "IT_PROP_COMP", self.rng, lo=0.0),
            "VT_PROP_COMP":  _noisy(vt_prop_comp, "VT_PROP_COMP", self.rng, lo=0.0),
            "LT_PROP_ACUM":  round(self.lt_prop_acum, 2),
            # Stabilizer
            "PT_STAB":     _noisy(pt_stab, "PT_STAB", self.rng),
            "TT_STAB_TOP": _noisy(tt_stab_top, "TT_STAB_TOP", self.rng),
            "TT_STAB_BOT": _noisy(tt_stab_bot, "TT_STAB_BOT", self.rng),
            "FT_COND_OUT": _noisy(ft_cond_out, "FT_COND_OUT", self.rng, lo=0.0),
            "AI_RVP":      _noisy(ai_rvp, "AI_RVP", self.rng),
            # Compression
            "PT_COMP_SUCT":  _noisy(pt_comp_suct, "PT_COMP_SUCT", self.rng, lo=0.0),
            "PT_COMP_DISCH": _noisy(pt_comp_disch, "PT_COMP_DISCH", self.rng, lo=0.0),
            "TT_COMP_SUCT":  _noisy(tt_comp_suct, "TT_COMP_SUCT", self.rng, lo=0.0),
            "TT_COMP_DISCH": _noisy(tt_comp_disch, "TT_COMP_DISCH", self.rng, lo=20.0),
            "SI_COMP":       round(self.comp_speed, 1),
            "VT_COMP":       _noisy(vt_comp, "VT_COMP", self.rng, lo=0.0),
            "ZT_ANTISURGE":  round(physics.clip(zt_antisurge, 0.0, 100.0), 1),
            "FT_RECYCLE":    _noisy(ft_recycle, "FT_RECYCLE", self.rng, lo=0.0),
            # Fiscal — NAG-602
            "FQI_GAS_FISCAL":   round(max(0.0, inlet_gas * flow_factor), 3),
            "FQI_COND_FISCAL":  round(max(0.0, ft_cond_out), 3),
            # Spec limits 8850-10200 / 11300-12470 are NAG-602 compliance bounds, not physical
            # bounds — let actual signal exceed them so the dashboard can highlight off-spec moments.
            "AI_PCS":           _noisy(pcs, "AI_PCS", self.rng, lo=8000, hi=11000),
            "AI_WOBBE":         _noisy(wobbe, "AI_WOBBE", self.rng, lo=10500, hi=13500),
            "AI_DENSITY":       round(density, 4),
            "AI_DEW_HC_FISCAL": round(physics.clip(dew_hc, -10.0, -4.0), 2),
            "AI_H2O_FISCAL":    _noisy(outlet_h2o, "AI_H2O_FISCAL", self.rng, lo=0.0),
            "AI_H2S_FISCAL":    round(fiscal_comp.h2s, 3),
            "AI_S_TOTAL":       round(s_total, 3),
            "AI_CO2_FISCAL":    round(fiscal_comp.co2, 3),
            "AI_O2_FISCAL":     round(max(0.0, self.rng.normal(0.05, 0.02)), 4),
        }
