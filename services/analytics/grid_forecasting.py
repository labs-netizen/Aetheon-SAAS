"""Committed-load day-ahead forecasting with bounded walk-forward model evidence."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import List, Tuple

import numpy as np

from grid_model_tournament import (MAX_VALIDATION_DAYS, MIN_VALIDATION_DAYS, SIMPLE,
    empirical_intervals, final_day, tournament)
from schemas import (GridForecastBlock, GridForecastProvenance, GridForecastRequest,
    GridForecastResponse, GridValidationMetrics)

MODEL_VERSION = "GRID_HISTORICAL_LOAD_V2.0"
MIN_COMPLETE_DAYS = 42
MAX_FRESHNESS_DAYS = 1
MAX_NORMALIZED_MAE = 0.20
MAX_SMAPE_PCT = 25.0


def chronological_split(training_dates: List[date]) -> Tuple[List[date], List[date]]:
    """Compatibility helper; selection now uses day-wise walk-forward evaluation."""
    count = min(MAX_VALIDATION_DAYS, max(MIN_VALIDATION_DAYS, len(training_dates) // 5))
    return training_dates[:-count], training_dates[-count:]


def _evidence_fields(result):
    if result is None:
        return dict(selected_model=None, runner_up=None, baseline_model=None, validation_metrics=None,
            baseline_metrics={}, model_comparison_metrics={}, improvement_vs_baseline_percent=None,
            validation_days=0, ensemble_weights={}, empirical_interval_status="INSUFFICIENT_EVIDENCE",
            drift_status="INSUFFICIENT_EVIDENCE")
    scores = result["metrics"]
    return dict(selected_model=result["selected"], runner_up=result["runner_up"], baseline_model=result["baseline"],
        validation_metrics=scores[result["selected"]], baseline_metrics={name: scores[name] for name in SIMPLE[:2]},
        model_comparison_metrics=scores, improvement_vs_baseline_percent=result["improvement_pct"],
        validation_days=len(result["validation_dates"]), ensemble_weights=result["weights"],
        empirical_interval_status="AVAILABLE" if len(result["validation_dates"]) >= MIN_VALIDATION_DAYS else "INSUFFICIENT_EVIDENCE",
        drift_status=result["drift"])


def _suppressed(req: GridForecastRequest, status: str, reason: str, dates: List[date],
                target: date | None = None, freshness_days: int | None = None,
                validation_status: str | None = None, result=None) -> GridForecastResponse:
    latest = dates[-1] if dates else None
    return GridForecastResponse(site_id=req.site_id, operating_date=req.operating_date,
        model_status=status, validation_status=validation_status or status, forecast_available=False,
        forecast_status="SUPPRESSED", model_version=MODEL_VERSION,
        model_generation_time=datetime.now(timezone.utc).isoformat(),
        training_start_date=dates[max(0, len(dates) - 180)].isoformat() if dates else None,
        training_end_date=latest.isoformat() if latest else None,
        latest_input_date=latest.isoformat() if latest else None,
        forecast_target_date=target.isoformat() if target else None, freshness_days=freshness_days,
        provenance=GridForecastProvenance(input_source="COMMITTED_INTERVAL_DATA_96",
            model_family="DAY_AHEAD_DEMAND", validation_method="WALK_FORWARD", price_source=None),
        blocks=[], is_suppressed=True, suppression_reason=reason, confidence_status="UNAVAILABLE",
        data_quality="UNVERIFIED", freshness="STALE" if status == "STALE_INPUT" else "UNKNOWN",
        price_status="AUTHORITATIVE_PRICE_FEED_REQUIRED", **_evidence_fields(result))


def solve_historical_grid_forecast(req: GridForecastRequest) -> GridForecastResponse:
    history = {date.fromisoformat(day.operating_date): np.asarray(day.load_kw, dtype=float)
               for day in req.historical_days}
    dates = sorted(history)
    if len(dates) < MIN_COMPLETE_DAYS:
        return _suppressed(req, "CALIBRATING", "INSUFFICIENT_COMPLETE_HISTORY", dates)
    latest = dates[-1]
    target = latest + timedelta(days=1)
    if not req.latest_input_complete:
        return _suppressed(req, "CALIBRATING", "INCOMPLETE_LATEST_OPERATING_DAY", dates, target)
    if date.fromisoformat(req.operating_date) != target:
        return _suppressed(req, "FAILED_VALIDATION", "FORECAST_TARGET_MUST_FOLLOW_LATEST_INPUT", dates, target)

    result = tournament(history)
    if result is None:
        return _suppressed(req, "CALIBRATING", "INSUFFICIENT_WALK_FORWARD_VALIDATION_DAYS", dates, target)
    selected: GridValidationMetrics = result["metrics"][result["selected"]]
    if selected.normalized_mae is None or selected.normalized_mae > MAX_NORMALIZED_MAE or selected.smape_pct > MAX_SMAPE_PCT:
        return _suppressed(req, "FAILED_VALIDATION", "MODEL_VALIDATION_THRESHOLDS_NOT_MET", dates, target,
            result=result)
    evaluation_date = date.fromisoformat(req.evaluation_date) if req.evaluation_date else date.today()
    freshness_days = (evaluation_date - latest).days
    if freshness_days < 0:
        return _suppressed(req, "FAILED_VALIDATION", "LATEST_INPUT_DATE_IS_IN_THE_FUTURE", dates, target,
            freshness_days, result=result)
    if freshness_days > MAX_FRESHNESS_DAYS and not req.historical_replay:
        return _suppressed(req, "STALE_INPUT", "STALE_INPUT", dates, target, freshness_days,
            validation_status="VALIDATED", result=result)

    forecast = final_day(history, target, result)
    if forecast is None or forecast.shape != (96,) or not np.all(np.isfinite(forecast)):
        return _suppressed(req, "CALIBRATING", "REQUIRED_FORECAST_LAGS_UNAVAILABLE", dates, target,
            freshness_days, validation_status="CALIBRATING", result=result)
    interval = empirical_intervals(result, forecast)
    evidence = _evidence_fields(result)
    evidence["empirical_interval_status"] = "AVAILABLE" if interval is not None else "INSUFFICIENT_EVIDENCE"
    blocks = []
    for index, value in enumerate(forecast, start=1):
        start_minutes = (index - 1) * 15
        end_minutes = index * 15
        blocks.append(GridForecastBlock(block_index=index,
            start_time=f"{start_minutes // 60:02d}:{start_minutes % 60:02d}",
            end_time="24:00" if end_minutes == 1440 else f"{end_minutes // 60:02d}:{end_minutes % 60:02d}",
            forecast_load_kw=round(float(value), 2),
            lower_bound_kw=round(float(interval[0][index - 1]), 2) if interval else None,
            upper_bound_kw=round(float(interval[1][index - 1]), 2) if interval else None))
    peak = int(np.argmax(forecast))
    return GridForecastResponse(site_id=req.site_id, operating_date=target.isoformat(),
        model_status="VALIDATED", validation_status="VALIDATED", forecast_available=True,
        forecast_status="AVAILABLE", model_version=MODEL_VERSION,
        model_generation_time=datetime.now(timezone.utc).isoformat(),
        training_start_date=dates[max(0, len(dates) - 180)].isoformat(),
        training_end_date=latest.isoformat(), latest_input_date=latest.isoformat(),
        forecast_target_date=target.isoformat(), freshness_days=freshness_days,
        provenance=GridForecastProvenance(input_source="COMMITTED_INTERVAL_DATA_96",
            model_family="DAY_AHEAD_DEMAND", validation_method="WALK_FORWARD", price_source=None),
        peak_demand_kw=round(float(forecast[peak]), 2), peak_demand_block=peak + 1,
        blocks=blocks, confidence_status="EMPIRICAL_INTERVAL" if interval else "UNAVAILABLE",
        data_quality="PASSED", freshness="STALE" if freshness_days > MAX_FRESHNESS_DAYS else "RECENT",
        price_status="AUTHORITATIVE_PRICE_FEED_REQUIRED", **evidence)
