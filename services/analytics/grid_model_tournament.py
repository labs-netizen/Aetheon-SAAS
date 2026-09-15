"""Leakage-safe, bounded day-ahead model tournament over committed 96-block days."""

from __future__ import annotations

from datetime import date, timedelta
import math
from typing import Dict

import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import ElasticNet, Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from schemas import GridValidationMetrics

SIMPLE = ("PREVIOUS_DAY_SAME_BLOCK", "PREVIOUS_WEEK_SAME_BLOCK", "ROLLING_7_DAY_SAME_BLOCK")
COMPLEX = ("RIDGE_MULTI_LAG_CALENDAR", "ELASTIC_NET_MULTI_LAG_CALENDAR", "HIST_GRADIENT_BOOSTING")
ENSEMBLE = "VALIDATED_WEIGHTED_ENSEMBLE"
LAGS = (1, 2, 3, 7, 14, 28)
MAX_TRAIN_DAYS = 180
MAX_VALIDATION_DAYS = 28
MIN_VALIDATION_DAYS = 14
MIN_FEATURE_TRAIN_DAYS = 14
REFIT_EVERY_DAYS = 14


def feature_day(history: Dict[date, np.ndarray], target: date,
                cache: dict[date, np.ndarray | None] | None = None) -> np.ndarray | None:
    """Only dates strictly before target contribute feature values."""
    if cache is not None and target in cache:
        return cache[target]
    prior = [history.get(target - timedelta(days=offset)) for offset in range(1, 29)]
    if any(day is None for day in prior):
        if cache is not None:
            cache[target] = None
        return None
    loads = np.stack(prior)  # 28 x 96; row zero is yesterday.
    columns = [loads[offset - 1] for offset in LAGS]
    columns += [np.mean(loads[:span], axis=0) for span in (3, 7, 14, 28)]
    columns += [np.median(loads[:span], axis=0) for span in (7, 28)]
    columns += [np.std(loads[:span], axis=0) for span in (7, 28)]
    daily_mean = loads.mean(axis=1)
    daily_peak = loads.max(axis=1)
    columns += [np.full(96, daily_mean[0]), np.full(96, daily_peak[0]),
                np.full(96, daily_mean[:7].mean()), np.full(96, daily_peak[:7].max()),
                np.full(96, np.polyfit(np.arange(7), daily_mean[:7][::-1], 1)[0])]
    weights = 0.25 * np.power(0.75, np.arange(28))
    weights /= weights.sum()
    columns.append(np.average(loads, axis=0, weights=weights))
    blocks = np.arange(96, dtype=float)
    weekday = target.weekday()
    columns += [blocks + 1, blocks / 4, blocks % 4,
                np.full(96, weekday), np.full(96, float(weekday >= 5)), np.full(96, target.month),
                np.full(96, math.sin(2 * math.pi * target.timetuple().tm_yday / 365.25)),
                np.full(96, math.cos(2 * math.pi * target.timetuple().tm_yday / 365.25)),
                np.sin(2 * math.pi * blocks / 96), np.cos(2 * math.pi * blocks / 96)]
    features = np.column_stack(columns)
    if cache is not None:
        cache[target] = features
    return features


def baseline_day(history: Dict[date, np.ndarray], target: date, name: str) -> np.ndarray | None:
    if name == SIMPLE[0]:
        value = history.get(target - timedelta(days=1))
        return value.copy() if value is not None else None
    if name == SIMPLE[1]:
        value = history.get(target - timedelta(days=7))
        return value.copy() if value is not None else None
    days = [history.get(target - timedelta(days=offset)) for offset in range(1, 8)]
    return np.mean(np.stack(days), axis=0) if all(day is not None for day in days) else None


def fit_complex(history: Dict[date, np.ndarray], through: date, names=COMPLEX,
                feature_cache: dict[date, np.ndarray | None] | None = None):
    dates = [day for day in sorted(history) if day <= through][-MAX_TRAIN_DAYS:]
    usable = [(day, features) for day in dates if (features := feature_day(history, day, feature_cache)) is not None]
    if len(usable) < MIN_FEATURE_TRAIN_DAYS:
        return {}, None
    x = np.concatenate([features for _, features in usable])
    y = np.concatenate([history[day] for day, _ in usable])
    constructors = {
        COMPLEX[0]: lambda: make_pipeline(StandardScaler(), Ridge(alpha=30.0)),
        COMPLEX[1]: lambda: make_pipeline(StandardScaler(), ElasticNet(alpha=0.05, l1_ratio=0.25,
                                                                       max_iter=700, tol=1e-3, selection="cyclic")),
        COMPLEX[2]: lambda: HistGradientBoostingRegressor(max_iter=24, max_leaf_nodes=15,
                                                            min_samples_leaf=80, l2_regularization=10.0,
                                                            learning_rate=0.08, random_state=42),
    }
    models = {}
    for name in names:
        model = constructors[name]()
        model.fit(x, y)
        models[name] = model
    return models, usable[-1][0]


def candidate_day(history: Dict[date, np.ndarray], target: date, name: str, models,
                  feature_cache: dict[date, np.ndarray | None] | None = None) -> np.ndarray | None:
    if name in SIMPLE:
        return baseline_day(history, target, name)
    features = feature_day(history, target, feature_cache)
    if features is None or name not in models:
        return None
    forecast = np.asarray(models[name].predict(features), dtype=float)
    return np.maximum(0, forecast) if forecast.shape == (96,) and np.all(np.isfinite(forecast)) else None


def metrics(actual_days: list[np.ndarray], prediction_days: list[np.ndarray]) -> GridValidationMetrics:
    actual = np.stack(actual_days)
    predicted = np.stack(prediction_days)
    error = predicted - actual
    absolute = np.abs(error)
    mae = float(absolute.mean())
    rmse = float(np.sqrt(np.mean(error ** 2)))
    denominator = np.abs(actual) + np.abs(predicted)
    smape = float(np.mean(np.divide(200 * absolute, denominator, out=np.zeros_like(absolute), where=denominator > 1e-9)))
    daily_mae = absolute.mean(axis=1)
    return GridValidationMetrics(mae_kw=round(mae, 3), rmse_kw=round(rmse, 3), smape_pct=round(smape, 3),
        observations=int(actual.size), normalized_mae=round(mae / float(actual.mean()), 5) if actual.mean() > 0 else None,
        peak_magnitude_error_kw=round(float(np.mean(np.abs(predicted.max(axis=1) - actual.max(axis=1)))), 3),
        peak_timing_error_minutes=round(float(np.mean(np.abs(predicted.argmax(axis=1) - actual.argmax(axis=1)) * 15)), 3),
        daily_mae_mean_kw=round(float(daily_mae.mean()), 3), daily_mae_median_kw=round(float(np.median(daily_mae)), 3))


def _rank(name: str, scored: dict[str, GridValidationMetrics]):
    score = scored[name]
    return (score.mae_kw, score.smape_pct, score.rmse_kw, 0 if name in SIMPLE else 1, name)


def prefer_simple(complex_mae: float, simple_mae: float) -> bool:
    return simple_mae - complex_mae <= max(2.0, 0.01 * simple_mae)


def ensemble_outperforms(ensemble_mae: float, individual_mae: float) -> bool:
    return individual_mae - ensemble_mae > max(2.0, 0.01 * individual_mae)


def _weights(previous_actual: list[np.ndarray], previous_predictions: dict[str, list[np.ndarray]], names: list[str]):
    errors = np.asarray([metrics(previous_actual, previous_predictions[name]).mae_kw for name in names], dtype=float)
    raw = 1 / np.maximum(errors, 1.0)
    weights = raw / raw.sum()
    # Cap concentration without inventing negative weights.
    for _ in range(6):
        over = weights > 0.65
        if not np.any(over):
            break
        surplus = float((weights[over] - 0.65).sum())
        weights[over] = 0.65
        under = ~over
        weights[under] += surplus * weights[under] / weights[under].sum()
    return {name: float(weight) for name, weight in zip(names, weights)}


def drift_status(history: Dict[date, np.ndarray], evaluation_dates: list[date], actual_days: list[np.ndarray],
                 prediction_days: list[np.ndarray]) -> str:
    dates = sorted(history)
    if len(dates) < 63 or len(evaluation_dates) < 14:
        return "INSUFFICIENT_EVIDENCE"
    recent = np.stack([history[day] for day in dates[-7:]])
    older = np.stack([history[day] for day in dates[-63:-7]])
    level_change = abs(float(recent.mean() - older.mean())) / max(float(older.mean()), 1.0)
    variance_change = float(recent.std()) / max(float(older.std()), 1.0)
    daily_errors = np.asarray([np.mean(np.abs(predicted - actual)) for actual, predicted in zip(actual_days, prediction_days)])
    error_change = float(daily_errors[-7:].mean()) / max(float(np.median(daily_errors[:-7])), 1.0)
    return "DRIFT_WARNING" if (level_change > 0.2 or variance_change > 1.8 or
        (error_change > 1.5 and daily_errors[-7:].mean() > 25)) else "NORMAL"


def evaluate_ensemble(actual_days: list[np.ndarray], predictions: dict[str, list[np.ndarray]],
                      scored: dict[str, GridValidationMetrics]):
    """Sequential out-of-fold weights: day N uses only errors from days before N."""
    if len(actual_days) < 21 or len(scored) < 2:
        return None
    early_scores = {name: metrics(actual_days[:7], values[:7]) for name, values in predictions.items()}
    top = sorted(early_scores, key=lambda name: _rank(name, early_scores))[:3]
    if len(top) < 2:
        return None
    ensemble_days = []
    for index in range(7, len(actual_days)):
        prior_weights = _weights(actual_days[:index], {name: values[:index] for name, values in predictions.items()}, top)
        ensemble_days.append(sum(predictions[name][index] * prior_weights[name] for name in top))
    ensemble_score = metrics(actual_days[7:], ensemble_days)
    suffix_scores = {name: metrics(actual_days[7:], values[7:]) for name, values in predictions.items()}
    suffix_best = min(suffix_scores, key=lambda name: _rank(name, suffix_scores))
    suffix_simple = min((name for name in SIMPLE if name in suffix_scores), key=lambda name: _rank(name, suffix_scores))
    if suffix_best not in SIMPLE and prefer_simple(suffix_scores[suffix_best].mae_kw, suffix_scores[suffix_simple].mae_kw):
        suffix_best = suffix_simple
    if not ensemble_outperforms(ensemble_score.mae_kw, suffix_scores[suffix_best].mae_kw):
        return None
    suffix_predictions = {name: values[7:] for name, values in predictions.items()}
    suffix_predictions[ENSEMBLE] = ensemble_days
    weights = _weights(actual_days[7:], {name: suffix_predictions[name] for name in top}, top)
    return {"metrics": {**suffix_scores, ENSEMBLE: ensemble_score}, "actual_days": actual_days[7:],
            "predictions": suffix_predictions, "weights": weights, "offset": 7}


def tournament(history: Dict[date, np.ndarray]):
    dates = sorted(history)
    feature_cache: dict[date, np.ndarray | None] = {}
    eligible = [day for day in dates if feature_day(history, day, feature_cache) is not None and
                all(baseline_day(history, day, name) is not None for name in SIMPLE)]
    evaluation_dates = eligible[-MAX_VALIDATION_DAYS:]
    if len(evaluation_dates) < MIN_VALIDATION_DAYS or evaluation_dates[-1] != dates[-1]:
        return None
    actual_days = [history[day] for day in evaluation_dates]
    predictions: dict[str, list[np.ndarray]] = {name: [] for name in SIMPLE}
    models, fit_end = fit_complex(history, evaluation_dates[0] - timedelta(days=1), feature_cache=feature_cache)
    for name in models:
        predictions[name] = []
    fit_history = []
    for index, day in enumerate(evaluation_dates):
        if index and index % REFIT_EVERY_DAYS == 0 and models:
            models, fit_end = fit_complex(history, day - timedelta(days=1), tuple(models), feature_cache)
        fit_history.append(fit_end)
        for name in list(predictions):
            prediction = candidate_day(history, day, name, models, feature_cache)
            if prediction is None:
                del predictions[name]
            else:
                predictions[name].append(prediction)
    predictions = {name: values for name, values in predictions.items() if len(values) == len(evaluation_dates)}
    scored = {name: metrics(actual_days, values) for name, values in predictions.items()}
    if not all(name in scored for name in SIMPLE):
        return None
    simple_best = min(SIMPLE, key=lambda name: _rank(name, scored))
    ranked = sorted(scored, key=lambda name: _rank(name, scored))
    selected = ranked[0]
    # Prefer a simple measured baseline if complexity gains are immaterial.
    if selected not in SIMPLE and prefer_simple(scored[selected].mae_kw, scored[simple_best].mae_kw):
        selected = simple_best
    weights = {}
    ensemble = evaluate_ensemble(actual_days, predictions, scored)
    if ensemble is not None:
        selected = ENSEMBLE
        scored = ensemble["metrics"]
        actual_days = ensemble["actual_days"]
        evaluation_dates = evaluation_dates[ensemble["offset"]:]
        predictions = ensemble["predictions"]
        weights = ensemble["weights"]
        fit_history = fit_history[ensemble["offset"]:]
    baseline_best = min(SIMPLE, key=lambda name: _rank(name, scored))
    runner_up = next((name for name in sorted(scored, key=lambda name: _rank(name, scored)) if name != selected), None)
    improvement = 100 * (scored[baseline_best].mae_kw - scored[selected].mae_kw) / max(scored[baseline_best].mae_kw, 1e-9)
    return {"selected": selected, "runner_up": runner_up, "baseline": baseline_best,
        "metrics": scored, "improvement_pct": round(improvement, 3), "validation_dates": evaluation_dates,
        "actual_days": actual_days, "predictions": predictions, "weights": weights,
        "fit_end_dates": fit_history, "_feature_cache": feature_cache,
        "drift": drift_status(history, evaluation_dates, actual_days, predictions[selected])}


def final_day(history: Dict[date, np.ndarray], target: date, result) -> np.ndarray | None:
    selected = result["selected"]
    names = tuple(result["weights"]) if selected == ENSEMBLE else (selected,) if selected in COMPLEX else ()
    models, _ = fit_complex(history, target - timedelta(days=1), names,
                             result["_feature_cache"]) if names else ({}, None)
    if selected == ENSEMBLE:
        constituents = [candidate_day(history, target, name, models, result["_feature_cache"]) for name in result["weights"]]
        if any(day is None for day in constituents):
            return None
        return sum(day * result["weights"][name] for name, day in zip(result["weights"], constituents))
    return candidate_day(history, target, selected, models, result["_feature_cache"])


def empirical_intervals(result, forecast: np.ndarray):
    actual_days = result["actual_days"]
    predictions = result["predictions"][result["selected"]]
    if len(actual_days) < MIN_VALIDATION_DAYS:
        return None
    residual = np.stack(actual_days) - np.stack(predictions)
    lower = np.maximum(0, np.minimum(forecast, forecast + np.quantile(residual, 0.05, axis=0)))
    upper = np.maximum(forecast, forecast + np.quantile(residual, 0.95, axis=0))
    return lower, upper
