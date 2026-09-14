from datetime import date, timedelta
import math
import os
import json
from pathlib import Path
import sys

from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("ANALYTICS_SERVICE_TOKEN", "fixture-test-analytics-token")

from grid_forecasting import chronological_split
from main import app
from schemas import GridForecastRequest, GridHistoricalDay
from solvers import solve_grid_forecast


def history(day_count=426, start=date(2025, 1, 1)):
    result = []
    for day_index in range(day_count):
        operating_date = start + timedelta(days=day_index)
        weekday_factor = 80 if operating_date.weekday() < 5 else -60
        loads = [
            1000 + weekday_factor + day_index * 0.2 + 180 * math.sin(2 * math.pi * block / 96)
            for block in range(96)
        ]
        result.append(GridHistoricalDay(operating_date=operating_date.isoformat(), load_kw=loads))
    return result


def request(days=None, evaluation_date=None, latest_input_complete=True):
    days = days if days is not None else history()
    latest = date.fromisoformat(days[-1].operating_date) if days else date(2026, 1, 1)
    return GridForecastRequest(
        site_id="site-real-history",
        operating_date=(latest + timedelta(days=1)).isoformat(),
        contract_demand_kw=2000,
        historical_days=days,
        evaluation_date=(evaluation_date or latest).isoformat(),
        latest_input_complete=latest_input_complete,
    )


def test_426_day_history_trains_backtests_and_emits_exactly_96_demand_blocks():
    response = solve_grid_forecast(request())
    assert response.model_status == "VALIDATED"
    assert response.validation_status == "VALIDATED"
    assert response.forecast_available
    assert response.forecast_status == "AVAILABLE"
    assert len(response.blocks) == 96
    assert [block.block_index for block in response.blocks] == list(range(1, 97))
    assert response.validation_metrics.observations >= 14 * 96
    assert set(response.baseline_metrics) == {"PREVIOUS_DAY_SAME_BLOCK", "PREVIOUS_WEEK_SAME_BLOCK"}
    assert response.selected_model in {
        "PREVIOUS_DAY_SAME_BLOCK", "PREVIOUS_WEEK_SAME_BLOCK", "RIDGE_MULTI_LAG_CALENDAR"
    }
    assert response.average_price_inr_per_mwh is None
    assert response.price_status == "AUTHORITATIVE_PRICE_FEED_REQUIRED"
    assert response.provenance.input_source == "COMMITTED_INTERVAL_DATA_96"
    assert all(block.forecast_load_kw >= 0 for block in response.blocks)
    assert all(block.forecast_price_inr_per_mwh is None and block.is_high_cost_window is None for block in response.blocks)


def test_chronological_validation_split_never_places_future_days_in_training():
    dates = [date.fromisoformat(day.operating_date) for day in history(100)]
    training, holdout = chronological_split(dates)
    assert len(holdout) >= 14
    assert max(training) < min(holdout)


def test_stale_april_history_is_validated_but_operationally_suppressed():
    days = history(426, date(2025, 3, 1))
    response = solve_grid_forecast(request(days, evaluation_date=date(2026, 9, 15)))
    assert response.latest_input_date == days[-1].operating_date
    assert response.validation_status == "VALIDATED"
    assert response.model_status == "STALE_INPUT"
    assert response.forecast_status == "SUPPRESSED"
    assert response.freshness_days > 1
    assert response.is_suppressed and not response.forecast_available and response.blocks == []


def test_captured_stale_fastapi_json_matches_shared_typescript_fixture():
    days = history(426, date(2025, 3, 1))
    payload = request(days, evaluation_date=date(2026, 9, 15)).model_dump()
    response = TestClient(app).post(
        "/v1/grid/forecast",
        json=payload,
        headers={"Authorization": "Bearer fixture-test-analytics-token"},
    )
    assert response.status_code == 200
    actual = response.json()
    fixture_path = Path(__file__).parents[3] / "tests" / "fixtures" / "grid_forecast_stale_response.json"
    expected = json.loads(fixture_path.read_text(encoding="utf-8"))
    actual["model_generation_time"] = expected["model_generation_time"]
    assert actual == expected


def test_captured_validated_fastapi_json_matches_shared_typescript_fixture():
    days = history(80, date(2026, 1, 1))
    payload = request(days).model_dump()
    response = TestClient(app).post(
        "/v1/grid/forecast",
        json=payload,
        headers={"Authorization": "Bearer fixture-test-analytics-token"},
    )
    assert response.status_code == 200
    actual = response.json()
    fixture_path = Path(__file__).parents[3] / "tests" / "fixtures" / "grid_forecast_validated_response.json"
    expected = json.loads(fixture_path.read_text(encoding="utf-8"))
    actual["model_generation_time"] = expected["model_generation_time"]
    assert actual == expected


def test_incomplete_latest_day_suppresses_even_with_valid_training_history():
    response = solve_grid_forecast(request(latest_input_complete=False))
    assert response.model_status == "CALIBRATING"
    assert response.forecast_status == "SUPPRESSED"
    assert response.suppression_reason == "INCOMPLETE_LATEST_OPERATING_DAY"
    assert response.blocks == []


def test_insufficient_history_suppresses_without_fabrication():
    response = solve_grid_forecast(request(history(20)))
    assert response.model_status == "CALIBRATING"
    assert response.suppression_reason == "INSUFFICIENT_COMPLETE_HISTORY"
    assert response.blocks == []


def test_failed_chronological_validation_suppresses_unreliable_forecast():
    days = []
    start = date(2026, 1, 1)
    for day_index in range(80):
        loads = [100.0 if ((day_index * 37 + block * 53) % 11) < 5 else 1900.0 for block in range(96)]
        days.append(GridHistoricalDay(operating_date=(start + timedelta(days=day_index)).isoformat(), load_kw=loads))
    response = solve_grid_forecast(request(days))
    assert response.model_status == "FAILED_VALIDATION"
    assert response.validation_status == "FAILED_VALIDATION"
    assert response.forecast_status == "SUPPRESSED"
    assert response.suppression_reason == "MODEL_VALIDATION_THRESHOLDS_NOT_MET"
    assert response.validation_metrics is not None
    assert response.blocks == []


def test_analytics_endpoint_keeps_bearer_authentication():
    payload = request(history(20)).model_dump()
    client = TestClient(app)
    assert client.post("/v1/grid/forecast", json=payload).status_code == 401
    response = client.post(
        "/v1/grid/forecast",
        json=payload,
        headers={"Authorization": "Bearer fixture-test-analytics-token"},
    )
    assert response.status_code == 200
    assert response.json()["model_status"] == "CALIBRATING"
