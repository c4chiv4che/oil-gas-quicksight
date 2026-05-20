"""Gas composition propagation: mix, dehydrate, dew-point shift, fiscal quality."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Iterable


# Component constants for PCS / Wobbe / density calculations.
# pcs_kcal: gross heating value per m³ at 15°C, 101.325 kPa.
# density: relative to air (28.96 g/mol).
_COMP_PCS_KCAL = {
    "c1": 9520, "c2": 16860, "c3": 24180, "c4": 31370, "c5_plus": 38690,
    "co2": 0, "n2": 0,
}
_COMP_MW = {
    "c1": 16.04, "c2": 30.07, "c3": 44.10, "c4": 58.12, "c5_plus": 72.15,
    "co2": 44.01, "n2": 28.01,
}
_AIR_MW = 28.96


@dataclass
class GasComposition:
    """%molar for hydrocarbons + CO2 + N2.  h2s/h2o expressed as mg/m³."""
    c1: float
    c2: float
    c3: float
    c4: float
    c5_plus: float
    co2: float
    n2: float
    h2s: float = 0.0           # mg/m³
    h2o: float = 0.0           # mg/m³

    @classmethod
    def from_dict(cls, d: dict[str, float]) -> "GasComposition":
        return cls(**{k: float(v) for k, v in d.items()})

    def normalize(self) -> "GasComposition":
        """Rescale molar components so they sum to 100%.  Leaves h2s/h2o (mg/m³) alone."""
        total = self.c1 + self.c2 + self.c3 + self.c4 + self.c5_plus + self.co2 + self.n2
        if total <= 0:
            return self
        k = 100.0 / total
        return replace(
            self,
            c1=self.c1 * k, c2=self.c2 * k, c3=self.c3 * k, c4=self.c4 * k,
            c5_plus=self.c5_plus * k, co2=self.co2 * k, n2=self.n2 * k,
        )

    def c1_fraction(self) -> float:
        return self.c1 / 100.0

    def pcs_kcal_m3(self) -> float:
        """Gross heating value (AI_PCS).  Σ(yi · PCSi)."""
        return sum(
            getattr(self, k) / 100.0 * pcs
            for k, pcs in _COMP_PCS_KCAL.items()
        )

    def relative_density(self) -> float:
        """AI_DENSITY: MW_gas / MW_air."""
        mw = sum(getattr(self, k) / 100.0 * mw for k, mw in _COMP_MW.items())
        return mw / _AIR_MW if mw > 0 else 0.65

    def wobbe_kcal_m3(self) -> float:
        """AI_WOBBE = PCS / √(relative density)."""
        d = self.relative_density()
        return self.pcs_kcal_m3() / (d ** 0.5) if d > 0 else 0.0

    def total_sulfur_mg_m3(self) -> float:
        """For AI_S_TOTAL.  Assume sulfur ≈ H2S only on a sweet gas (no mercaptans modelled)."""
        # 34 g/mol H2S → 32 g/mol S
        return self.h2s * (32.0 / 34.0)


def composition_shift(base: GasComposition, gor: float, t_days: float) -> GasComposition:
    """Rising GOR → slightly leaner gas (lower C1, higher C2-C5).  Subtle effect."""
    # delta scales with how far GOR has moved from baseline 300.
    # Clamp at 0.5 (the value already reached at gor=800, the top of the
    # realistic 100-800 range) so unrealistic GORs don't crush the c1 floor
    # after normalize().  Below gor=800 this clamp is a no-op.
    drift = min(0.5, max(0.0, (gor - 300.0) / 500.0) * 0.5)
    c1 = max(78.0, base.c1 - drift * 4.0)
    c2 = base.c2 + drift * 2.0
    c3 = base.c3 + drift * 1.2
    c4 = base.c4 + drift * 0.4
    c5 = base.c5_plus + drift * 0.4
    return replace(base, c1=c1, c2=c2, c3=c3, c4=c4, c5_plus=c5).normalize()


def weighted_mix(streams: Iterable[tuple[GasComposition, float]]) -> GasComposition:
    """Flow-weighted mixture of multiple gas streams.  Weights are mass/volume rates (any unit, ratio matters)."""
    streams = [(c, max(0.0, w)) for c, w in streams]
    total_w = sum(w for _, w in streams)
    if total_w <= 0:
        # default fallback — return first stream as-is
        return streams[0][0] if streams else GasComposition(85, 8, 3, 1, 0.5, 1, 1.5, 1, 250)
    def avg(attr: str) -> float:
        return sum(getattr(c, attr) * w for c, w in streams) / total_w
    return GasComposition(
        c1=avg("c1"), c2=avg("c2"), c3=avg("c3"), c4=avg("c4"), c5_plus=avg("c5_plus"),
        co2=avg("co2"), n2=avg("n2"), h2s=avg("h2s"), h2o=avg("h2o"),
    ).normalize()


def teg_dehydrate(inlet_h2o_mg_m3: float, circ_lh: float, T_contactor_C: float,
                  purity_pct: float) -> float:
    """Water removal efficiency.  Better at higher circulation, lower T, higher purity.
    Returns outlet H2O in mg/m³.  Target ≤ 65 mg/m³ per NAG-602."""
    base_eff = 0.92
    eff_circ = min(0.07, max(0.0, (circ_lh - 800.0) / 700.0 * 0.07))
    eff_T = min(0.05, max(-0.05, (40.0 - T_contactor_C) / 10.0 * 0.05))
    eff_pur = min(0.04, max(-0.04, (purity_pct - 99.0) / 0.5 * 0.04))
    eff = max(0.70, min(0.995, base_eff + eff_circ + eff_T + eff_pur))
    return float(inlet_h2o_mg_m3 * (1.0 - eff))


def lts_reduce_hc_dewpoint(inlet_T_C: float, dT: float = 25.0) -> float:
    """LTS reduces HC dew point by ~20-30°C depending on chiller performance."""
    return inlet_T_C - dT
