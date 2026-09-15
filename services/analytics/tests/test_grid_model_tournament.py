"""Adversarial chronology and selection tests for committed-load forecasting."""

from datetime import date, timedelta
import math
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from grid_model_tournament import (COMPLEX, ENSEMBLE, SIMPLE, _rank, _weights,
    baseline_day, candidate_day, drift_status, empirical_intervals,
    ensemble_outperforms, evaluate_ensemble, feature_day, fit_complex, metrics, prefer_simple, tournament)
from schemas import GridValidationMetrics


def history(count=90, start=date(2026, 1, 1)):
    result = {}
    for index in range(count):
        day = start + timedelta(days=index)
        weekday = 80 if day.weekday() < 5 else -60
        result[day] = np.asarray([1000 + weekday + index * 0.2 + 180 * math.sin(2 * math.pi * block / 96)
                                  for block in range(96)])
    return result


@pytest.fixture(scope="module")
def evaluated():
    return tournament(history())


def test_features_exclude_target_and_future_actuals():
    days = history(50)
    target = sorted(days)[45]
    before = feature_day(days, target)
    assert before.shape == (96, 30)
    for day in sorted(days)[45:]:
        days[day] = np.full(96, 100000)
    np.testing.assert_array_equal(feature_day(days, target), before)


def test_recent_history_gap_cannot_be_hidden_by_older_walk_forward_days():
    days = history(90)
    del days[sorted(days)[-10]]
    assert tournament(days) is None


def test_all_baselines_and_fitted_candidates_emit_one_ordered_96_block_day():
    days = history(80)
    target = sorted(days)[-1] + timedelta(days=1)
    models, fit_end = fit_complex(days, target - timedelta(days=1))
    assert fit_end < target
    assert set(models) == set(COMPLEX)
    for name in (*SIMPLE, *COMPLEX):
        prediction = candidate_day(days, target, name, models)
        assert prediction.shape == (96,), name
        assert np.all(np.isfinite(prediction)) and np.all(prediction >= 0)


def test_walk_forward_fit_never_sees_evaluation_day_or_later(evaluated):
    assert evaluated is not None
    assert len(evaluated["validation_dates"]) >= 14
    assert len(evaluated["fit_end_dates"]) == len(evaluated["validation_dates"])
    assert all(fit is None or fit < day for fit, day in
               zip(evaluated["fit_end_dates"], evaluated["validation_dates"]))
    assert all(len(values) == len(evaluated["validation_dates"]) for values in evaluated["predictions"].values())
    assert SIMPLE[0] in evaluated["metrics"] and SIMPLE[1] in evaluated["metrics"]


def test_tournament_is_deterministic_and_ranks_mae_then_smape_then_rmse(evaluated):
    again = tournament(history())
    assert again["selected"] == evaluated["selected"]
    assert again["metrics"] == evaluated["metrics"]
    scores = {
        "A": GridValidationMetrics(mae_kw=10, rmse_kw=20, smape_pct=5, observations=96),
        "B": GridValidationMetrics(mae_kw=10, rmse_kw=15, smape_pct=4, observations=96),
        "C": GridValidationMetrics(mae_kw=9, rmse_kw=100, smape_pct=50, observations=96),
    }
    assert sorted(scores, key=lambda name: _rank(name, scores)) == ["C", "B", "A"]


def test_simple_preference_and_ensemble_require_material_gain():
    assert prefer_simple(99.5, 100)
    assert not prefer_simple(95, 100)
    assert not ensemble_outperforms(99.5, 100)
    assert ensemble_outperforms(95, 100)


def test_inverse_error_ensemble_weights_are_nonnegative_capped_and_sum_to_one():
    actual = [np.full(96, 1000.0) for _ in range(7)]
    forecasts = {"GOOD": [np.full(96, 1001.0) for _ in actual],
                 "POOR": [np.full(96, 1500.0) for _ in actual]}
    weights = _weights(actual, forecasts, list(forecasts))
    assert all(0 <= weight <= 0.65 for weight in weights.values())
    assert sum(weights.values()) == pytest.approx(1.0)


def test_ensemble_is_selected_only_after_out_of_fold_measured_improvement():
    actual = [np.full(96, 1000.0) for _ in range(28)]
    complementary = {SIMPLE[0]: [np.full(96, 1100.0) for _ in actual],
                     SIMPLE[1]: [np.full(96, 900.0) for _ in actual],
                     SIMPLE[2]: [np.full(96, 1200.0) for _ in actual]}
    scores = {name: metrics(actual, values) for name, values in complementary.items()}
    chosen = evaluate_ensemble(actual, complementary, scores)
    assert chosen is not None
    assert chosen["metrics"][ENSEMBLE].mae_kw < min(score.mae_kw for score in scores.values())
    assert len(chosen["predictions"][ENSEMBLE]) == 21
    assert sum(chosen["weights"].values()) == pytest.approx(1.0)
    same = {name: [np.full(96, 1100.0) for _ in actual] for name in SIMPLE}
    assert evaluate_ensemble(actual, same, {name: metrics(actual, values) for name, values in same.items()}) is None


def test_empirical_residual_intervals_need_fourteen_prior_validation_days(evaluated):
    target_forecast = baseline_day(history(), sorted(history())[-1] + timedelta(days=1), SIMPLE[1])
    interval = empirical_intervals(evaluated, target_forecast)
    assert interval is not None
    assert interval[0].shape == interval[1].shape == (96,)
    assert np.all(interval[0] <= target_forecast) and np.all(target_forecast <= interval[1])
    short = {**evaluated, "actual_days": evaluated["actual_days"][:13],
             "predictions": {name: values[:13] for name, values in evaluated["predictions"].items()}}
    assert empirical_intervals(short, target_forecast) is None


def test_drift_uses_only_observed_history_and_reports_insufficient_evidence():
    short = history(30)
    assert drift_status(short, list(short)[-14:], [short[day] for day in list(short)[-14:]],
                        [short[day] for day in list(short)[-14:]]) == "INSUFFICIENT_EVIDENCE"
    shifted = history(80)
    for day in sorted(shifted)[-7:]:
        shifted[day] *= 2
    dates = sorted(shifted)[-28:]
    assert drift_status(shifted, dates, [shifted[day] for day in dates],
                        [np.full(96, 1000) for _ in dates]) == "DRIFT_WARNING"


def test_metric_vector_has_daily_and_peak_evidence_without_fake_outputs():
    actual = [np.arange(96, dtype=float) + 100]
    forecast = [actual[0] + 10]
    scored = metrics(actual, forecast)
    assert scored.mae_kw == 10
    assert scored.peak_magnitude_error_kw == 10
    assert scored.peak_timing_error_minutes == 0
    assert scored.normalized_mae > 0
