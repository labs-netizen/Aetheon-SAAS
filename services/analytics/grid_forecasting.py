"""Deterministic, leakage-safe V1 day-ahead demand forecasting."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import math
from typing import Dict, Iterable, List, Tuple

import numpy as np

from schemas import (
    GridForecastBlock,
    GridForecastRequest,
    GridForecastResponse,
    GridValidationMetrics,
)


MODEL_VERSION = "GRID_HISTORICAL_LOAD_V1.0"
MIN_COMPLETE_DAYS = 42
MIN_HOLDOUT_DAYS = 14
MAX_HOLDOUT_DAYS = 28
MAX_FRESHNESS_DAYS = 1
MAX_NORMALIZED_MAE = 0.20
MAX_SMAPE_PCT = 25.0


def chronological_split(training_dates: List[date]) -> Tuple[List[date], List[date]]:
    """Return an ordered train/holdout split with every train date before holdout."""
    holdout_count = min(MAX_HOLDOUT_DAYS, max(MIN_HOLDOUT_DAYS, len(training_dates) // 5))
    return training_dates[:-holdout_count], training_dates[-holdout_count:]


def _metrics(actual: np.ndarray, predicted: np.ndarray) -> GridValidationMetrics:
    errors = predicted - actual
    mae = float(np.mean(np.abs(errors)))
    rmse = float(np.sqrt(np.mean(np.square(errors))))
    denominator = np.abs(actual) + np.abs(predicted)
    smape = float(np.mean(np.where(denominator > 1e-9, 200.0 * np.abs(errors) / denominator, 0.0)))
    return GridValidationMetrics(
        mae_kw=round(mae, 3),
        rmse_kw=round(rmse, 3),
        smape_pct=round(smape, 3),
        observations=int(actual.size),
    )


def _calendar_features(target: date, block_index: int) -> List[float]:
    day_angle = 2.0 * math.pi * target.weekday() / 7.0
    month_angle = 2.0 * math.pi * (target.month - 1) / 12.0
    block_angle = 2.0 * math.pi * (block_index - 1) / 96.0
    return [
        math.sin(day_angle), math.cos(day_angle),
        math.sin(month_angle), math.cos(month_angle),
        math.sin(block_angle), math.cos(block_angle),
    ]


def _lag_features(history: Dict[date, np.ndarray], target: date, block: int) -> List[float] | None:
    lag_dates = [target - timedelta(days=1), target - timedelta(days=7), target - timedelta(days=14)]
    if any(lag_date not in history for lag_date in lag_dates):
        return None
    rolling_dates = [target - timedelta(days=offset) for offset in range(1, 8)]
    if any(rolling_date not in history for rolling_date in rolling_dates):
        return None
    return [
        float(history[lag_dates[0]][block]),
        float(history[lag_dates[1]][block]),
        float(history[lag_dates[2]][block]),
        float(np.mean([history[rolling_date][block] for rolling_date in rolling_dates])),
        *_calendar_features(target, block + 1),
    ]


def _fit_ridge(history: Dict[date, np.ndarray], training_dates: Iterable[date]) -> np.ndarray | None:
    rows: List[List[float]] = []
    targets: List[float] = []
    for target in training_dates:
        for block in range(96):
            features = _lag_features(history, target, block)
            if features is not None:
                rows.append([1.0, *features])
                targets.append(float(history[target][block]))
    if len(rows) < 96 * 14:
        return None
    matrix = np.asarray(rows, dtype=float)
    values = np.asarray(targets, dtype=float)
    penalty = np.eye(matrix.shape[1], dtype=float) * 1e-3
    penalty[0, 0] = 0.0
    return np.linalg.solve(matrix.T @ matrix + penalty, matrix.T @ values)


def _ridge_day(history: Dict[date, np.ndarray], target: date, coefficients: np.ndarray) -> np.ndarray | None:
    rows = []
    for block in range(96):
        features = _lag_features(history, target, block)
        if features is None:
            return None
        rows.append([1.0, *features])
    return np.maximum(0.0, np.asarray(rows, dtype=float) @ coefficients)


def _naive_day(history: Dict[date, np.ndarray], target: date, lag_days: int) -> np.ndarray | None:
    values = history.get(target - timedelta(days=lag_days))
    return values.copy() if values is not None else None


def _suppressed(
    req: GridForecastRequest,
    status: str,
    reason: str,
    latest_input_date: date | None,
    target_date: date | None,
    freshness_days: int | None,
    validation_status: str,
    training_dates: List[date],
    baseline_metrics: Dict[str, GridValidationMetrics] | None = None,
    validation_metrics: GridValidationMetrics | None = None,
    selected_model: str | None = None,
) -> GridForecastResponse:
    return GridForecastResponse(
        site_id=req.site_id,
        operating_date=(target_date or date.fromisoformat(req.operating_date)).isoformat(),
        model_status=status,
        validation_status=validation_status,
        forecast_available=False,
        model_version=MODEL_VERSION,
        model_generation_time=datetime.now(timezone.utc).isoformat(),
        training_start_date=training_dates[0].isoformat() if training_dates else None,
        training_end_date=training_dates[-1].isoformat() if training_dates else None,
        latest_input_date=latest_input_date.isoformat() if latest_input_date else None,
        forecast_target_date=target_date.isoformat() if target_date else None,
        freshness_days=freshness_days,
        selected_model=selected_model,
        validation_metrics=validation_metrics,
        baseline_metrics=baseline_metrics or {},
        blocks=[],
        is_suppressed=True,
        suppression_reason=reason,
        confidence_status="UNAVAILABLE",
        data_quality="UNVERIFIED",
        freshness="STALE" if status == "STALE_INPUT" else "UNKNOWN",
    )


def solve_historical_grid_forecast(req: GridForecastRequest) -> GridForecastResponse:
    history = {
        date.fromisoformat(day.operating_date): np.asarray(day.load_kw, dtype=float)
        for day in req.historical_days
    }
    training_dates = sorted(history)
    if len(training_dates) < MIN_COMPLETE_DAYS:
        return _suppressed(req, "CALIBRATING", "INSUFFICIENT_COMPLETE_HISTORY", training_dates[-1] if training_dates else None,
                           None, None, "CALIBRATING", training_dates)
    if not req.latest_input_complete:
        latest = training_dates[-1]
        return _suppressed(req, "CALIBRATING", "INCOMPLETE_LATEST_OPERATING_DAY", latest, latest + timedelta(days=1),
                           None, "CALIBRATING", training_dates)

    latest = training_dates[-1]
    target_date = latest + timedelta(days=1)
    if date.fromisoformat(req.operating_date) != target_date:
        return _suppressed(req, "FAILED_VALIDATION", "FORECAST_TARGET_MUST_FOLLOW_LATEST_INPUT", latest, target_date,
                           None, "FAILED_VALIDATION", training_dates)

    fit_dates, holdout_dates = chronological_split(training_dates)
    coefficients = _fit_ridge(history, fit_dates)

    actual_days: List[np.ndarray] = []
    predictions: Dict[str, List[np.ndarray]] = {
        "PREVIOUS_DAY_SAME_BLOCK": [],
        "PREVIOUS_WEEK_SAME_BLOCK": [],
        "RIDGE_MULTI_LAG_CALENDAR": [],
    }
    eligible_dates = []
    for holdout_date in holdout_dates:
        previous_day = _naive_day(history, holdout_date, 1)
        previous_week = _naive_day(history, holdout_date, 7)
        ridge = _ridge_day(history, holdout_date, coefficients) if coefficients is not None else None
        if previous_day is None or previous_week is None or ridge is None:
            continue
        eligible_dates.append(holdout_date)
        actual_days.append(history[holdout_date])
        predictions["PREVIOUS_DAY_SAME_BLOCK"].append(previous_day)
        predictions["PREVIOUS_WEEK_SAME_BLOCK"].append(previous_week)
        predictions["RIDGE_MULTI_LAG_CALENDAR"].append(ridge)

    if len(eligible_dates) < MIN_HOLDOUT_DAYS:
        return _suppressed(req, "CALIBRATING", "INSUFFICIENT_CHRONOLOGICAL_HOLDOUT_DAYS", latest, target_date,
                           None, "CALIBRATING", training_dates)

    actual = np.concatenate(actual_days)
    candidate_metrics = {
        name: _metrics(actual, np.concatenate(values))
        for name, values in predictions.items()
    }
    selected_model = min(candidate_metrics, key=lambda name: candidate_metrics[name].mae_kw)
    selected_metrics = candidate_metrics[selected_model]
    baseline_metrics = {
        name: candidate_metrics[name]
        for name in ("PREVIOUS_DAY_SAME_BLOCK", "PREVIOUS_WEEK_SAME_BLOCK")
    }
    mean_load = float(np.mean(actual))
    validation_passed = (
        mean_load > 0
        and selected_metrics.mae_kw / mean_load <= MAX_NORMALIZED_MAE
        and selected_metrics.smape_pct <= MAX_SMAPE_PCT
    )
    if not validation_passed:
        return _suppressed(req, "FAILED_VALIDATION", "MODEL_VALIDATION_THRESHOLDS_NOT_MET", latest, target_date,
                           None, "FAILED_VALIDATION", training_dates, baseline_metrics, selected_metrics, selected_model)

    evaluation_date = date.fromisoformat(req.evaluation_date) if req.evaluation_date else date.today()
    freshness_days = (evaluation_date - latest).days
    if freshness_days < 0:
        return _suppressed(req, "FAILED_VALIDATION", "LATEST_INPUT_DATE_IS_IN_THE_FUTURE", latest, target_date,
                           freshness_days, "VALIDATED", training_dates, baseline_metrics, selected_metrics, selected_model)
    if freshness_days > MAX_FRESHNESS_DAYS:
        return _suppressed(req, "STALE_INPUT", "STALE_INPUT", latest, target_date, freshness_days, "VALIDATED",
                           training_dates, baseline_metrics, selected_metrics, selected_model)

    if selected_model == "PREVIOUS_DAY_SAME_BLOCK":
        forecast = _naive_day(history, target_date, 1)
    elif selected_model == "PREVIOUS_WEEK_SAME_BLOCK":
        forecast = _naive_day(history, target_date, 7)
    else:
        forecast = _ridge_day(history, target_date, coefficients) if coefficients is not None else None
    if forecast is None:
        return _suppressed(req, "CALIBRATING", "REQUIRED_FORECAST_LAGS_UNAVAILABLE", latest, target_date,
                           freshness_days, "VALIDATED", training_dates, baseline_metrics, selected_metrics, selected_model)

    confidence_width = 1.96 * selected_metrics.rmse_kw
    blocks = []
    for block_index, forecast_kw in enumerate(forecast, start=1):
        start_minutes = (block_index - 1) * 15
        end_minutes = block_index * 15
        blocks.append(GridForecastBlock(
            block_index=block_index,
            start_time=f"{start_minutes // 60:02d}:{start_minutes % 60:02d}",
            end_time="24:00" if end_minutes == 1440 else f"{end_minutes // 60:02d}:{end_minutes % 60:02d}",
            forecast_demand_kw=round(float(forecast_kw), 2),
            confidence_lower_kw=round(max(0.0, float(forecast_kw) - confidence_width), 2),
            confidence_upper_kw=round(float(forecast_kw) + confidence_width, 2),
        ))
    peak_index = int(np.argmax(forecast))
    return GridForecastResponse(
        site_id=req.site_id,
        operating_date=target_date.isoformat(),
        model_status="VALIDATED",
        validation_status="VALIDATED",
        forecast_available=True,
        model_version=MODEL_VERSION,
        model_generation_time=datetime.now(timezone.utc).isoformat(),
        training_start_date=training_dates[0].isoformat(),
        training_end_date=training_dates[-1].isoformat(),
        latest_input_date=latest.isoformat(),
        forecast_target_date=target_date.isoformat(),
        freshness_days=freshness_days,
        selected_model=selected_model,
        validation_metrics=selected_metrics,
        baseline_metrics=baseline_metrics,
        peak_demand_kw=round(float(forecast[peak_index]), 2),
        peak_demand_block=peak_index + 1,
        blocks=blocks,
        confidence_status="VALIDATED_BACKTEST",
        data_quality="PASSED",
        freshness="RECENT",
        price_status="AUTHORITATIVE_PRICE_FEED_REQUIRED",
    )
