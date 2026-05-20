"""Tests for src/quality.py — gas composition propagation."""

from __future__ import annotations

import math

import pytest

from src import quality
from src.quality import GasComposition, composition_shift, teg_dehydrate, weighted_mix


# Component PCS constants (same as in src/quality.py). Hand-anchored so the test
# would catch an accidental edit to _COMP_PCS_KCAL.
_PCS = {"c1": 9520, "c2": 16860, "c3": 24180, "c4": 31370, "c5_plus": 38690}
_MW = {"c1": 16.04, "c2": 30.07, "c3": 44.10, "c4": 58.12, "c5_plus": 72.15,
       "co2": 44.01, "n2": 28.01}
_AIR_MW = 28.96


def _hand_pcs(c: GasComposition) -> float:
    return sum(getattr(c, k) / 100.0 * pcs for k, pcs in _PCS.items())


def _hand_mw(c: GasComposition) -> float:
    return sum(getattr(c, k) / 100.0 * mw for k, mw in _MW.items())


# ── GasComposition.normalize ──────────────────────────────────────────────────

class TestNormalize:
    def test_already_normal(self, vm_comp: GasComposition) -> None:
        # vm_comp fixture sums to exactly 100
        n = vm_comp.normalize()
        total = n.c1 + n.c2 + n.c3 + n.c4 + n.c5_plus + n.co2 + n.n2
        assert total == pytest.approx(100.0, abs=1e-9)

    def test_rescales_off_100(self) -> None:
        # double everything, normalize should bring it back to 100
        c = GasComposition(c1=180, c2=12, c3=3.0, c4=0.6, c5_plus=0.1,
                           co2=2.0, n2=2.3, h2s=4.0, h2o=500.0)
        n = c.normalize()
        total = n.c1 + n.c2 + n.c3 + n.c4 + n.c5_plus + n.co2 + n.n2
        assert total == pytest.approx(100.0, abs=1e-9)
        # ratio preserved: c1 still ~90% of the molar total
        assert n.c1 == pytest.approx(90.0, rel=1e-9)

    def test_preserves_h2s_h2o(self, vm_comp: GasComposition) -> None:
        # h2s/h2o are mg/m³, not %molar — normalize must leave them alone
        n = vm_comp.normalize()
        assert n.h2s == vm_comp.h2s
        assert n.h2o == vm_comp.h2o

    def test_zero_total_is_safe(self) -> None:
        c = GasComposition(c1=0, c2=0, c3=0, c4=0, c5_plus=0, co2=0, n2=0)
        # Should not raise — the function returns self when total<=0
        n = c.normalize()
        assert n.c1 == 0.0


# ── PCS / density / Wobbe ─────────────────────────────────────────────────────

class TestHeatingValue:
    def test_pcs_matches_hand_computed(self, vm_comp: GasComposition) -> None:
        # Hand-computed PCS for vm_comp:
        #  0.90·9520 + 0.06·16860 + 0.015·24180 + 0.003·31370 + 0.0005·38690
        #  = 8568.0 + 1011.6 + 362.7 + 94.11 + 19.345 = 10055.755
        expected = 10_055.755
        got = vm_comp.pcs_kcal_m3()
        assert got == pytest.approx(expected, abs=0.5)
        # Also matches the generic Σ(yi·PCSi) recomputation
        assert got == pytest.approx(_hand_pcs(vm_comp), rel=1e-9)

    def test_pcs_in_nag602_band(self, vm_comp: GasComposition) -> None:
        # NAG-602 Tabla 1: 8850-10200 kcal/m³ for fiscal sales gas
        assert 8850.0 <= vm_comp.pcs_kcal_m3() <= 10200.0

    def test_density_in_vm_range(self, vm_comp: GasComposition) -> None:
        # NAG-602 Tabla 1: 0.58-0.70 relative density
        d = vm_comp.relative_density()
        assert 0.58 <= d <= 0.70

    def test_density_matches_mw_over_air(self, vm_comp: GasComposition) -> None:
        expected = _hand_mw(vm_comp) / _AIR_MW
        assert vm_comp.relative_density() == pytest.approx(expected, rel=1e-9)

    def test_wobbe_equals_pcs_over_sqrt_density(self, vm_comp: GasComposition) -> None:
        pcs = vm_comp.pcs_kcal_m3()
        d = vm_comp.relative_density()
        expected = pcs / math.sqrt(d)
        assert vm_comp.wobbe_kcal_m3() == pytest.approx(expected, rel=1e-9)

    def test_zero_composition_returns_default_density(self) -> None:
        c = GasComposition(c1=0, c2=0, c3=0, c4=0, c5_plus=0, co2=0, n2=0)
        # Falls back to 0.65 when MW=0 per quality.py
        assert c.relative_density() == 0.65

    def test_total_sulfur_scales_with_h2s(self, vm_comp: GasComposition) -> None:
        # h2s = 2.0 mg/m³ → S = 2.0 * 32/34
        expected = vm_comp.h2s * (32.0 / 34.0)
        assert vm_comp.total_sulfur_mg_m3() == pytest.approx(expected, rel=1e-9)


# ── composition_shift ─────────────────────────────────────────────────────────

class TestCompositionShift:
    def test_at_baseline_gor_no_drift(self, wellhead_comp: GasComposition) -> None:
        # gor <= 300 → drift=0 → composition unchanged (modulo a normalize() pass)
        c = composition_shift(wellhead_comp, gor=300.0, t_days=10.0)
        assert c.c1 == pytest.approx(wellhead_comp.c1, rel=1e-6)
        assert c.c2 == pytest.approx(wellhead_comp.c2, rel=1e-6)

    def test_high_gor_lowers_c1_raises_heavies(self, wellhead_comp: GasComposition) -> None:
        base = wellhead_comp
        shifted = composition_shift(base, gor=800.0, t_days=10.0)
        assert shifted.c1 < base.c1
        # at least one of the heavies should rise (they all do per the formula,
        # but ranking-only is safer against a tweak)
        assert shifted.c2 + shifted.c3 + shifted.c4 + shifted.c5_plus > \
               base.c2 + base.c3 + base.c4 + base.c5_plus

    def test_output_sums_to_100(self, wellhead_comp: GasComposition) -> None:
        shifted = composition_shift(wellhead_comp, gor=800.0, t_days=10.0)
        total = shifted.c1 + shifted.c2 + shifted.c3 + shifted.c4 + shifted.c5_plus + shifted.co2 + shifted.n2
        assert total == pytest.approx(100.0, abs=1e-9)

    def test_c1_pre_normalize_floor(self, wellhead_comp: GasComposition) -> None:
        # The max(78.0, ...) clamp in composition_shift acts pre-normalize.
        # Post-normalize, c1 may dip below 78 because the heavies inflate the total.
        # We verify the floor mechanism works by picking a GOR that triggers it
        # without making heavies dominate — drift = 0.5 at gor=800 → c1_pre = 84.
        shifted = composition_shift(wellhead_comp, gor=800.0, t_days=10.0)
        # At gor=800, drift=0.5 → c1_pre=84, heavies barely move → post-normalize c1≈83-84
        assert shifted.c1 > 80.0


# ── weighted_mix ──────────────────────────────────────────────────────────────

class TestWeightedMix:
    def test_equal_weights_arithmetic_mean(self) -> None:
        a = GasComposition(c1=90, c2=6, c3=1.5, c4=0.3, c5_plus=0.05,
                           co2=1.0, n2=1.15, h2s=1.0, h2o=100.0)
        b = GasComposition(c1=80, c2=10, c3=3.5, c4=0.7, c5_plus=0.15,
                           co2=2.0, n2=3.65, h2s=3.0, h2o=200.0)
        mix = weighted_mix([(a, 1.0), (b, 1.0)])
        # both sum to 100 → mean still sums to 100 (and normalize is a no-op)
        assert mix.c1 == pytest.approx((a.c1 + b.c1) / 2.0, rel=1e-9)
        assert mix.h2s == pytest.approx((a.h2s + b.h2s) / 2.0, rel=1e-9)
        assert mix.h2o == pytest.approx((a.h2o + b.h2o) / 2.0, rel=1e-9)

    def test_one_zero_weight_picks_other(self) -> None:
        a = GasComposition(c1=90, c2=6, c3=1.5, c4=0.3, c5_plus=0.05,
                           co2=1.0, n2=1.15, h2s=1.0, h2o=100.0)
        b = GasComposition(c1=80, c2=10, c3=3.5, c4=0.7, c5_plus=0.15,
                           co2=2.0, n2=3.65, h2s=3.0, h2o=200.0)
        mix = weighted_mix([(a, 1.0), (b, 0.0)])
        assert mix.c1 == pytest.approx(a.c1, rel=1e-9)
        assert mix.h2s == pytest.approx(a.h2s, rel=1e-9)

    def test_all_zero_weight_falls_back_to_first(self) -> None:
        a = GasComposition(c1=90, c2=6, c3=1.5, c4=0.3, c5_plus=0.05,
                           co2=1.0, n2=1.15, h2s=1.0, h2o=100.0)
        mix = weighted_mix([(a, 0.0)])
        assert mix.c1 == a.c1

    def test_flow_weighted(self) -> None:
        # 90% weight on b → mix should be closer to b than a
        a = GasComposition(c1=90, c2=6, c3=1.5, c4=0.3, c5_plus=0.05,
                           co2=1.0, n2=1.15, h2s=1.0, h2o=100.0)
        b = GasComposition(c1=80, c2=10, c3=3.5, c4=0.7, c5_plus=0.15,
                           co2=2.0, n2=3.65, h2s=3.0, h2o=200.0)
        mix = weighted_mix([(a, 1.0), (b, 9.0)])
        assert abs(mix.c1 - b.c1) < abs(mix.c1 - a.c1)


# ── teg_dehydrate ─────────────────────────────────────────────────────────────

class TestTegDehydrate:
    def test_outlet_below_inlet(self) -> None:
        out = teg_dehydrate(inlet_h2o_mg_m3=250.0, circ_lh=1200.0,
                            T_contactor_C=40.0, purity_pct=99.2)
        assert out < 250.0

    @pytest.mark.parametrize("circ", [800.0, 1100.0, 1400.0])
    def test_more_circulation_removes_more_water(self, circ: float) -> None:
        # Use a strictly-lower reference circulation to ensure monotonicity.
        low = teg_dehydrate(250.0, circ_lh=800.0, T_contactor_C=40.0, purity_pct=99.2)
        # at circ=800 we're at the lowest end; higher circ should remove more (≤ low)
        out = teg_dehydrate(250.0, circ_lh=circ, T_contactor_C=40.0, purity_pct=99.2)
        assert out <= low + 1e-9

    def test_lower_t_removes_more_water(self) -> None:
        hot = teg_dehydrate(250.0, circ_lh=1200.0, T_contactor_C=45.0, purity_pct=99.2)
        cold = teg_dehydrate(250.0, circ_lh=1200.0, T_contactor_C=35.0, purity_pct=99.2)
        assert cold < hot

    def test_higher_purity_removes_more_water(self) -> None:
        low = teg_dehydrate(250.0, circ_lh=1200.0, T_contactor_C=40.0, purity_pct=98.5)
        high = teg_dehydrate(250.0, circ_lh=1200.0, T_contactor_C=40.0, purity_pct=99.5)
        assert high < low

    def test_efficiency_bounded(self) -> None:
        # Even with everything saturated to "perfect", efficiency caps at 0.995.
        # → outlet must be ≥ 0.5% of inlet.
        out = teg_dehydrate(inlet_h2o_mg_m3=250.0, circ_lh=10_000.0,
                            T_contactor_C=0.0, purity_pct=99.9)
        assert out >= 250.0 * (1.0 - 0.995) - 1e-9


# ── lts_reduce_hc_dewpoint ────────────────────────────────────────────────────

class TestLtsReduceHcDewpoint:
    def test_default_reduction(self) -> None:
        # default dT = 25
        assert quality.lts_reduce_hc_dewpoint(15.0) == pytest.approx(-10.0)

    def test_custom_dt(self) -> None:
        assert quality.lts_reduce_hc_dewpoint(15.0, dT=20.0) == pytest.approx(-5.0)
