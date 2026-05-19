"""Pure physical models — no state, no I/O."""

from __future__ import annotations

import math
import numpy as np


def arps_hyperbolic(qi: float, b: float, Di: float, t_days: float) -> float:
    """Arps hyperbolic decline rate. b in [1.3, 1.8], Di in [0.008, 0.015] /d typical for Vaca Muerta."""
    if t_days <= 0:
        return qi
    return qi / (1.0 + b * Di * t_days) ** (1.0 / b)


def gor_creep(base_gor: float, t_days: float) -> float:
    """+0.3 m³/m³ per day, capped at 800."""
    return min(800.0, base_gor + max(0.0, t_days) * 0.3)


def watercut_creep(base_wc: float, t_days: float, flowback: bool = False) -> float:
    """Linear +0.0003/day until 0.45.  During FLOWBACK water cut is much higher (0.40-0.80)."""
    if flowback:
        # transient high WC during first 30d, decaying from ~0.7 to ~0.05
        wc = 0.05 + 0.65 * math.exp(-t_days / 12.0)
        return max(0.05, min(0.80, wc))
    return min(0.45, base_wc + max(0.0, t_days) * 0.0003)


def whp_from_oil_choke(oil_rate: float, choke_pct: float, base: float = 30.0) -> float:
    """Wellhead pressure: rises with oil rate, inversely with choke opening."""
    if choke_pct <= 0:
        return base
    return base + oil_rate * 1.2 * (100.0 / max(20.0, choke_pct))


def downhole_from_whp(whp: float, oil: float, gas: float) -> float:
    """Coarse static-column estimate."""
    return 200.0 + oil * 1.8 + gas * 0.5 + whp * 0.3


def hydrate_temp(P_bar: float, c1_frac: float = 0.87) -> float:
    """Simplified Katz-style hydrate formation temperature (°C) at pressure P.
    Heavier gas (lower c1) → slightly higher hydrate T. Rough fit for sweet natural gas."""
    base = -5.0 + 12.0 * math.log10(max(1.0, P_bar))
    composition_shift = (0.90 - c1_frac) * 8.0
    return base + composition_shift


def hydrate_risk(T_C: float, P_bar: float, h2o_mg_m3: float, c1_frac: float = 0.87) -> float:
    """Index 0-1.  Risk rises when T approaches/below hydrate curve AND water is present."""
    margin = T_C - hydrate_temp(P_bar, c1_frac)
    water_factor = min(1.0, h2o_mg_m3 / 200.0)
    if margin > 10:
        return 0.0
    if margin < -2:
        return min(1.0, water_factor)
    return max(0.0, (10.0 - margin) / 12.0) * water_factor


def corrosion_risk(h2s_mg_m3: float, h2o_mg_m3: float, T_C: float) -> float:
    """Index 0-1.  H2S + water + warm temp drives corrosion."""
    h2s_f = min(1.0, h2s_mg_m3 / 5.0)
    h2o_f = min(1.0, h2o_mg_m3 / 300.0)
    t_f = max(0.0, min(1.0, (T_C - 30.0) / 60.0))
    return round(h2s_f * h2o_f * (0.5 + 0.5 * t_f), 4)


def centrifugal_ratio(speed_rpm: float, base_rpm: float = 10000.0) -> float:
    """Compression ratio scales roughly with (N/N0)^2 around design point."""
    return (speed_rpm / base_rpm) ** 2 * 1.083  # design ratio ≈ 1.083 (63.7/58.8)


def antisurge_position(flow: float, surge_line: float) -> float:
    """Anti-surge valve % open. Opens proportionally as flow drops below surge line + 10% margin."""
    margin = surge_line * 1.10
    if flow >= margin:
        return 0.0
    if flow <= surge_line * 0.8:
        return 100.0
    return float((margin - flow) / (margin - surge_line * 0.8) * 100.0)


def add_noise(value: float, noise_pct: float, rng: np.random.Generator) -> float:
    """Gaussian noise proportional to value magnitude (with floor to avoid zero sigma)."""
    sigma = max(abs(value), 1e-3) * noise_pct
    return float(value + rng.normal(0.0, sigma))


def clip(v: float, lo: float, hi: float) -> float:
    return float(max(lo, min(hi, v)))
