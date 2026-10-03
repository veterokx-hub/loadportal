"""Ряды, робастная статистика и запасная разметка фаз. Без VictoriaMetrics."""
import math
import unittest

import numpy as np

from app.models import LoadProfile, PhaseKind, TestKind
from app.phases import analysable, detect, phase_at
from app.series import from_samples, ratio
from app.stats import (
    clean,
    longest_true_run,
    mann_kendall,
    percentile,
    robust_center_scale,
    theil_sen,
)


class SeriesTests(unittest.TestCase):
    def test_from_samples_drops_non_finite(self):
        series = from_samples("rps", "RPS", "rps", "load", [(1, 1.0), (2, float("nan")), (3, 3.0)])
        self.assertEqual(series.t.tolist(), [1, 3])
        self.assertEqual(series.v.tolist(), [1.0, 3.0])
        self.assertEqual(series.median(), 2.0)

        empty = from_samples("rps", "RPS", "rps", "load", [(1, float("inf"))])
        self.assertEqual(empty.status, "empty")
        self.assertTrue(empty.empty)

    def test_ratio_uses_last_known_denominator(self):
        num = from_samples("n", "n", "1", "g", [(10, 10.0), (50, 20.0)])
        den = from_samples("d", "d", "1", "g", [(0, 2.0), (100, 4.0)])
        out = ratio("q", "q", "1", "g", num, den)
        self.assertEqual(out.t.tolist(), [10, 50])
        self.assertEqual(out.v.tolist(), [5.0, 10.0])


class StatsTests(unittest.TestCase):
    def test_center_ignores_a_single_spike(self):
        center, scale = robust_center_scale(np.array([1.0, 1.0, 1.0, 1.0, 100.0]))
        self.assertEqual(center, 1.0)
        self.assertEqual(scale, 0.0)

    def test_theil_sen_slope(self):
        t = np.arange(6, dtype=float)
        slope = theil_sen(t, 2.0 * t + 3.0)
        self.assertTrue(math.isclose(slope, 2.0))
        self.assertEqual(theil_sen(np.array([0.0, 1.0]), np.array([0.0, 1.0])), 0.0)

    def test_mann_kendall_needs_eight_points(self):
        tau, p = mann_kendall(np.arange(7, dtype=float))
        self.assertEqual((tau, p), (0.0, 1.0))
        tau, p = mann_kendall(np.arange(12, dtype=float))
        self.assertGreater(tau, 0.9)
        self.assertLess(p, 0.01)

    def test_longest_run_and_percentile(self):
        self.assertEqual(longest_true_run(np.array([False, True, True, False, True])), (2, 1, 2))
        self.assertEqual(longest_true_run(np.array([False, False])), (0, -1, -1))
        self.assertEqual(percentile(np.array([]), 95), 0.0)
        self.assertEqual(clean([1.0, float("nan"), 2.0]).tolist(), [1.0, 2.0])


class PhaseTests(unittest.TestCase):
    def test_profile_fallback_when_series_is_missing(self):
        phases = detect(
            None,
            LoadProfile(test_kind=TestKind.RAMP_HOLD, target_rps=100, ramp_up_sec=60, hold_sec=120),
            start=1_000,
            end=1_180,
            warmup_skip_sec=0,
            cooldown_skip_sec=0,
        )
        self.assertEqual([p.kind for p in phases], [PhaseKind.RAMP, PhaseKind.PLATEAU])
        kept = analysable(phases, (PhaseKind.PLATEAU,))
        self.assertEqual(len(kept), 1)
        self.assertIs(phase_at(phases, 1_000), phases[0])
        self.assertIsNone(phase_at(phases, 1_181))


if __name__ == "__main__":
    unittest.main()
