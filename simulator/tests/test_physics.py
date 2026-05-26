"""Pure-function tests for src/physics.py."""

from __future__ import annotations

import math

import numpy as np
import pytest

from src import physics

# ── arps_hyperbolic ───────────────────────────────────────────────────────────


class TestArpsHyperbolic:
    def test_t_zero_returns_qi(self) -> None:
        assert physics.arps_hyperbolic(qi=100.0, b=1.5, Di=0.01, t_days=0.0) == 100.0

    def test_negative_t_returns_qi(self) -> None:
        assert physics.arps_hyperbolic(qi=100.0, b=1.5, Di=0.01, t_days=-5.0) == 100.0

    def test_monotonic_decreasing(self) -> None:
        ts = [1, 7, 30, 90, 180, 360, 720]
        vals = [physics.arps_hyperbolic(120.0, 1.5, 0.012, t) for t in ts]
        for a, b in zip(vals, vals[1:]):
            assert a > b, f"expected decline but {a} <= {b}"

    @pytest.mark.parametrize(
        "qi,b,Di,t,expected",
        [
            # q(t) = qi / (1 + b*Di*t)^(1/b)
            (100.0, 1.5, 0.01, 30.0, 100.0 / (1.0 + 1.5 * 0.01 * 30.0) ** (1.0 / 1.5)),
            (120.0, 1.3, 0.008, 90.0, 120.0 / (1.0 + 1.3 * 0.008 * 90.0) ** (1.0 / 1.3)),
            (80.0, 1.8, 0.015, 180.0, 80.0 / (1.0 + 1.8 * 0.015 * 180.0) ** (1.0 / 1.8)),
        ],
    )
    def test_known_values(self, qi: float, b: float, Di: float, t: float, expected: float) -> None:
        got = physics.arps_hyperbolic(qi, b, Di, t)
        assert got == pytest.approx(expected, rel=1e-9)

    def test_never_negative_even_for_huge_t(self) -> None:
        q = physics.arps_hyperbolic(100.0, 1.5, 0.015, t_days=10_000.0)
        assert q > 0.0
        assert q < 100.0


# ── gor_creep ─────────────────────────────────────────────────────────────────


class TestGorCreep:
    def test_t_zero_returns_base(self) -> None:
        assert physics.gor_creep(300.0, 0.0) == 300.0

    def test_increases_linearly(self) -> None:
        assert physics.gor_creep(300.0, 100.0) == pytest.approx(330.0)

    def test_capped_at_800(self) -> None:
        # +0.3 per day; 10_000 days would put us at 3300 absent the cap
        assert physics.gor_creep(300.0, 10_000.0) == 800.0

    def test_negative_t_treated_as_zero(self) -> None:
        assert physics.gor_creep(300.0, -50.0) == 300.0


# ── watercut_creep ────────────────────────────────────────────────────────────


class TestWatercutCreep:
    def test_normal_mode_starts_at_base(self) -> None:
        assert physics.watercut_creep(0.02, 0.0) == pytest.approx(0.02)

    def test_normal_mode_capped_at_045(self) -> None:
        # +0.0003/day; 10_000 days would be 3.02 absent cap
        assert physics.watercut_creep(0.02, 10_000.0) == 0.45

    def test_normal_mode_monotonic(self) -> None:
        a = physics.watercut_creep(0.02, 30.0)
        b = physics.watercut_creep(0.02, 90.0)
        assert b > a

    def test_flowback_starts_high(self) -> None:
        # exp(0) = 1, so wc = 0.05 + 0.65 = 0.70
        assert physics.watercut_creep(0.02, 0.0, flowback=True) == pytest.approx(0.70, rel=1e-6)

    def test_flowback_decays_toward_05(self) -> None:
        # after many tau the decay should approach 0.05
        wc_late = physics.watercut_creep(0.02, 100.0, flowback=True)
        assert wc_late == pytest.approx(0.05, abs=0.01)

    @pytest.mark.parametrize("t", [0.0, 5.0, 12.0, 24.0])
    def test_flowback_bounded(self, t: float) -> None:
        wc = physics.watercut_creep(0.02, t, flowback=True)
        assert 0.05 <= wc <= 0.80


# ── whp_from_oil_choke ────────────────────────────────────────────────────────


class TestWhpFromOilChoke:
    def test_choke_zero_returns_base(self) -> None:
        assert physics.whp_from_oil_choke(oil_rate=80.0, choke_pct=0.0, base=30.0) == 30.0

    def test_rises_with_oil(self) -> None:
        lo = physics.whp_from_oil_choke(20.0, 50.0)
        hi = physics.whp_from_oil_choke(100.0, 50.0)
        assert hi > lo

    @pytest.mark.parametrize("choke", [25.0, 50.0, 75.0, 100.0])
    def test_inverse_relation_with_choke(self, choke: float) -> None:
        # at a higher choke opening, WHP should be lower for the same oil rate
        # (until the max(20, choke) floor kicks in)
        baseline = physics.whp_from_oil_choke(80.0, 20.0)
        opened = physics.whp_from_oil_choke(80.0, choke)
        assert opened <= baseline + 1e-9


# ── downhole_from_whp ─────────────────────────────────────────────────────────


class TestDownholeFromWhp:
    def test_increases_with_each_input(self) -> None:
        base = physics.downhole_from_whp(whp=50.0, oil=80.0, gas=30.0)
        assert physics.downhole_from_whp(whp=80.0, oil=80.0, gas=30.0) > base
        assert physics.downhole_from_whp(whp=50.0, oil=120.0, gas=30.0) > base
        assert physics.downhole_from_whp(whp=50.0, oil=80.0, gas=60.0) > base


# ── hydrate_temp / hydrate_risk ───────────────────────────────────────────────


class TestHydrate:
    @pytest.mark.parametrize("P", [10.0, 30.0, 60.0, 100.0, 150.0])
    def test_hydrate_temp_rises_with_pressure(self, P: float) -> None:
        t_lo = physics.hydrate_temp(P_bar=P, c1_frac=0.87)
        t_hi = physics.hydrate_temp(P_bar=P * 2.0, c1_frac=0.87)
        assert t_hi > t_lo

    def test_heavier_gas_higher_hydrate_t(self) -> None:
        # lower c1 fraction → composition_shift positive → higher hydrate T
        t_light = physics.hydrate_temp(P_bar=50.0, c1_frac=0.90)
        t_heavy = physics.hydrate_temp(P_bar=50.0, c1_frac=0.80)
        assert t_heavy > t_light

    @pytest.mark.parametrize(
        "T_C,P_bar,h2o",
        [
            (50.0, 30.0, 100.0),  # well above hydrate curve
            (0.0, 80.0, 250.0),  # likely in risk window
            (-20.0, 100.0, 300.0),  # deep in hydrate region
            (25.0, 50.0, 0.0),  # no water → no risk
        ],
    )
    def test_hydrate_risk_in_0_1(self, T_C: float, P_bar: float, h2o: float) -> None:
        r = physics.hydrate_risk(T_C, P_bar, h2o)
        assert 0.0 <= r <= 1.0

    def test_no_water_no_risk(self) -> None:
        assert physics.hydrate_risk(T_C=-20.0, P_bar=100.0, h2o_mg_m3=0.0) == 0.0

    def test_far_above_curve_zero_risk(self) -> None:
        # T 50°C above hydrate curve → margin > 10 → 0
        r = physics.hydrate_risk(T_C=80.0, P_bar=30.0, h2o_mg_m3=500.0)
        assert r == 0.0


# ── corrosion_risk ────────────────────────────────────────────────────────────


class TestCorrosionRisk:
    @pytest.mark.parametrize(
        "h2s,h2o,T",
        [
            (0.0, 100.0, 50.0),
            (5.0, 300.0, 80.0),
            (3.0, 250.0, 30.0),
            (1.0, 10.0, 25.0),
        ],
    )
    def test_in_0_1(self, h2s: float, h2o: float, T: float) -> None:
        r = physics.corrosion_risk(h2s, h2o, T)
        assert 0.0 <= r <= 1.0

    def test_no_h2s_no_risk(self) -> None:
        assert physics.corrosion_risk(h2s_mg_m3=0.0, h2o_mg_m3=300.0, T_C=80.0) == 0.0

    def test_no_water_no_risk(self) -> None:
        assert physics.corrosion_risk(h2s_mg_m3=10.0, h2o_mg_m3=0.0, T_C=80.0) == 0.0

    def test_rises_with_temperature(self) -> None:
        cold = physics.corrosion_risk(h2s_mg_m3=5.0, h2o_mg_m3=300.0, T_C=30.0)
        warm = physics.corrosion_risk(h2s_mg_m3=5.0, h2o_mg_m3=300.0, T_C=80.0)
        assert warm > cold


# ── centrifugal_ratio ─────────────────────────────────────────────────────────


class TestCentrifugalRatio:
    def test_at_base_rpm_gives_design_ratio(self) -> None:
        assert physics.centrifugal_ratio(speed_rpm=10_000.0, base_rpm=10_000.0) == pytest.approx(
            1.083
        )

    def test_increases_with_speed(self) -> None:
        r_lo = physics.centrifugal_ratio(8_000.0)
        r_hi = physics.centrifugal_ratio(12_000.0)
        assert r_hi > r_lo

    def test_quadratic_in_speed(self) -> None:
        # ratio(2N) / ratio(N) == 4
        r1 = physics.centrifugal_ratio(5_000.0)
        r2 = physics.centrifugal_ratio(10_000.0)
        assert r2 / r1 == pytest.approx(4.0, rel=1e-9)


# ── antisurge_position ────────────────────────────────────────────────────────


class TestAntisurge:
    def test_above_margin_closed(self) -> None:
        # flow ≥ 1.10 * surge_line → 0
        assert physics.antisurge_position(flow=60.0, surge_line=50.0) == 0.0

    def test_below_floor_full_open(self) -> None:
        # flow ≤ 0.8 * surge_line → 100
        assert physics.antisurge_position(flow=30.0, surge_line=50.0) == 100.0

    def test_monotonic_between_bounds(self) -> None:
        surge = 50.0
        positions = [physics.antisurge_position(f, surge) for f in (54.0, 50.0, 45.0, 41.0)]
        # decreasing flow → opening more
        for a, b in zip(positions, positions[1:]):
            assert b >= a


# ── clip ──────────────────────────────────────────────────────────────────────


class TestClip:
    @pytest.mark.parametrize(
        "v,lo,hi,expected",
        [
            (5.0, 0.0, 10.0, 5.0),
            (-5.0, 0.0, 10.0, 0.0),
            (15.0, 0.0, 10.0, 10.0),
            (0.0, 0.0, 10.0, 0.0),
            (10.0, 0.0, 10.0, 10.0),
        ],
    )
    def test_bounds(self, v: float, lo: float, hi: float, expected: float) -> None:
        assert physics.clip(v, lo, hi) == expected


# ── add_noise ─────────────────────────────────────────────────────────────────


class TestAddNoise:
    def test_zero_noise_pct_returns_value_within_floor(self) -> None:
        # noise_pct=0 → sigma == 1e-3 (floor), so result is value ± a tiny epsilon
        rng = np.random.default_rng(42)
        v = physics.add_noise(50.0, noise_pct=0.0, rng=rng)
        assert abs(v - 50.0) < 0.01  # 10× the sigma floor

    def test_seeded_deterministic(self) -> None:
        a = physics.add_noise(100.0, 0.01, np.random.default_rng(42))
        b = physics.add_noise(100.0, 0.01, np.random.default_rng(42))
        assert a == b

    def test_distribution_sigma(self) -> None:
        rng = np.random.default_rng(42)
        value = 100.0
        pct = 0.05
        samples = np.array([physics.add_noise(value, pct, rng) for _ in range(2000)])
        # sample std should be close to value * pct = 5.0
        assert math.isclose(samples.std(), value * pct, rel_tol=0.10)
        # mean should be close to value
        assert math.isclose(samples.mean(), value, abs_tol=0.5)
