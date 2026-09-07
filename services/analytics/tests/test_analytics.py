"""
Pytest test suite for Aetheon Analytics Microservice.
Tests physical feasibility, 96-block length invariants, and math boundaries.
"""

import pytest
from fastapi.testclient import TestClient
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from main import app
from schemas import (
    GridForecastRequest, DSMCalculationRequest,
    BESSSolverRequest, RenewableReconciliationRequest
)
from solvers import (
    solve_grid_forecast, solve_dsm_deviation,
    solve_bess_advisory, solve_renewable_reconciliation
)

client = TestClient(app)


def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


def test_grid_forecast_96_blocks():
    req = GridForecastRequest(
        site_id="site-demo-001",
        operating_date="2026-09-08",
        contract_demand_kw=2000.0
    )
    res = solve_grid_forecast(req)
    assert len(res.blocks) == 96
    assert res.blocks[0].block_index == 1
    assert res.blocks[95].block_index == 96
    assert res.peak_demand_kw > 0
    assert res.average_price_inr_per_mwh > 0
    # Every block must have valid start and end times
    assert res.blocks[0].start_time == "00:00"
    assert res.blocks[95].end_time == "24:00"


def test_dsm_deviation_calculation():
    scheduled = [1000.0] * 96
    actual = [1000.0] * 96
    actual[10] = 1100.0  # 10% excess (High risk)
    actual[20] = 1150.0  # 15% excess (Critical risk)
    actual[30] = 1050.0  # 5% excess (Watch risk)

    req = DSMCalculationRequest(
        site_id="site-demo-001",
        operating_date="2026-09-08",
        scheduled_drawal_kw=scheduled,
        actual_drawal_kw=actual,
        contract_demand_kw=1200.0
    )
    res = solve_dsm_deviation(req)
    assert len(res.blocks) == 96
    assert res.blocks[10].risk_level == "HIGH"
    assert res.blocks[20].risk_level == "CRITICAL"
    assert res.blocks[30].risk_level == "WATCH"
    assert res.blocks[0].risk_level == "NORMAL"
    assert res.estimated_total_exposure_inr > 0


def test_bess_advisory_physical_feasibility():
    # Construct 96-block price profile with clear night dip and evening peak
    prices = [2500.0] * 24 + [4500.0] * 48 + [8500.0] * 24

    req = BESSSolverRequest(
        battery_id="bess-001",
        site_id="site-001",
        operating_date="2026-09-08",
        usable_capacity_kwh=1000.0,
        power_rating_kw=500.0,
        initial_soc_pct=30.0,
        min_soc_pct=10.0,
        max_soc_pct=90.0,
        prices_inr_per_mwh=prices
    )
    res = solve_bess_advisory(req)
    assert len(res.blocks) == 96
    assert res.is_feasibility_verified is True

    for b in res.blocks:
        # SOC must strictly remain between min_soc and max_soc
        assert 10.0 <= b.resulting_soc_pct <= 90.0
        # Power must not exceed rating
        assert b.power_kw <= 500.0


def test_renewable_reconciliation():
    measured = [0.0] * 24 + [150.0] * 48 + [0.0] * 24
    req = RenewableReconciliationRequest(
        site_id="site-001",
        operating_date="2026-09-08",
        installed_capacity_kw=800.0,
        measured_generation_kwh=measured
    )
    res = solve_renewable_reconciliation(req)
    assert res.total_measured_generation_kwh == sum(measured)
    assert res.avoided_emissions_tco2e > 0


def test_service_token_authentication():
    # Calling calculation endpoint without token must return 401
    payload = {
        "site_id": "site-demo-001",
        "operating_date": "2026-09-08",
        "contract_demand_kw": 2000.0
    }
    unauthorized_res = client.post("/v1/grid/forecast", json=payload)
    assert unauthorized_res.status_code == 401

    # Calling with invalid token must return 401
    invalid_res = client.post(
        "/v1/grid/forecast",
        json=payload,
        headers={"Authorization": "Bearer wrong-token"}
    )
    assert invalid_res.status_code == 401

    # Calling with correct token must succeed
    authorized_res = client.post(
        "/v1/grid/forecast",
        json=payload,
        headers={"Authorization": "Bearer internal-dev-secret-token"}
    )
    assert authorized_res.status_code == 200


def test_bess_validation_invalid_soc():
    # min_soc >= max_soc must fail validation
    with pytest.raises(Exception):
        BESSSolverRequest(
            battery_id="bess-001",
            site_id="site-001",
            operating_date="2026-09-08",
            usable_capacity_kwh=1000.0,
            power_rating_kw=500.0,
            initial_soc_pct=50.0,
            min_soc_pct=90.0,  # invalid
            max_soc_pct=10.0,  # invalid
            prices_inr_per_mwh=[3000.0] * 96
        )

