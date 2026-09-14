"""Generate shared Grid contract fixtures from the real FastAPI endpoint."""

from datetime import date, datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("ANALYTICS_SERVICE_TOKEN", "fixture-test-analytics-token")

from fastapi.testclient import TestClient
from main import app


class FrozenDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        value = cls(2026, 9, 15, 0, 0, 0, tzinfo=timezone.utc)
        return value if tz is not None else value.replace(tzinfo=None)


def _history(day_count: int, start: date, noisy: bool = False):
    days = []
    for day_index in range(day_count):
        operating_date = start + timedelta(days=day_index)
        if noisy:
            loads = [100.0 if ((day_index * 37 + block * 53) % 11) < 5 else 1900.0 for block in range(96)]
        else:
            weekday_factor = 80 if operating_date.weekday() < 5 else -60
            loads = [
                1000 + weekday_factor + day_index * 0.2 + 180 * math.sin(2 * math.pi * block / 96)
                for block in range(96)
            ]
        days.append({"operating_date": operating_date.isoformat(), "load_kw": loads})
    return days


def _response(days, evaluation_date: date):
    latest = date.fromisoformat(days[-1]["operating_date"])
    payload = {
        "site_id": "site-real-history",
        "operating_date": (latest + timedelta(days=1)).isoformat(),
        "contract_demand_kw": 2000,
        "historical_days": days,
        "evaluation_date": evaluation_date.isoformat(),
        "latest_input_complete": True,
    }
    response = TestClient(app).post(
        "/v1/grid/forecast",
        json=payload,
        headers={"Authorization": "Bearer fixture-test-analytics-token"},
    )
    response.raise_for_status()
    return response.json()


def generate_contract_responses():
    eligible_days = _history(80, date(2026, 1, 1))
    stale_days = _history(426, date(2025, 3, 1))
    calibrating_days = _history(20, date(2026, 1, 1))
    failed_days = _history(80, date(2026, 1, 1), noisy=True)
    with patch("grid_forecasting.datetime", FrozenDateTime):
        return {
            "validated": _response(eligible_days, date.fromisoformat(eligible_days[-1]["operating_date"])),
            "stale_input": _response(stale_days, date(2026, 9, 15)),
            "calibrating": _response(calibrating_days, date.fromisoformat(calibrating_days[-1]["operating_date"])),
            "failed_validation": _response(failed_days, date.fromisoformat(failed_days[-1]["operating_date"])),
        }


if __name__ == "__main__":
    output = Path(__file__).parents[3] / "tests" / "fixtures" / "grid_forecast_contract_responses.json"
    output.write_text(json.dumps(generate_contract_responses(), indent=2) + "\n", encoding="utf-8")
