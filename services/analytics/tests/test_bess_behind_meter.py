import os
import pytest
from fastapi.testclient import TestClient

from bess_dispatch import solve_bess_behind_meter
from schemas import BESSBehindMeterRequest

os.environ.setdefault("TESTING", "1")
from main import app


def request(**overrides):
    prices = [2500.0] * 32 + [5000.0] * 32 + [9000.0] * 32
    values = dict(
        profile_id="profile-1", site_id="site-1", operating_date="2026-05-01",
        nameplate_energy_capacity_kwh=2000, max_charge_power_kw=500, max_discharge_power_kw=500,
        minimum_soc_percent=20, maximum_soc_percent=90, initial_soc_percent=50,
        final_soc_requirement="RETURN_TO_INITIAL_SOC", final_soc_percent=None,
        charge_efficiency_percent=95, discharge_efficiency_percent=95,
        maximum_daily_throughput_kwh=2000, degradation_cost_rs_per_kwh_throughput=0.5,
        forecast_load_kw=[10000.0] * 96, forecast_lower_kw=[9000.0] * 96,
        forecast_upper_kw=[11000.0] * 96, prices_inr_per_mwh=prices,
        price_source_reference="IEX DAM 2026-05-01", price_source_file_hash="sha256:test",
        price_provenance_status="OFFICIAL_SOURCE_CONFIRMED", price_verification_status="VERIFIED",
        forecast_model_version="GRID_HISTORICAL_LOAD_V2.0", forecast_selected_model="RIDGE",
        forecast_drift_status="STABLE",
    )
    values.update(overrides)
    return BESSBehindMeterRequest(**values)


def test_milp_dispatch_obeys_physical_and_economic_contract():
    req = request()
    result = solve_bess_behind_meter(req)
    assert result.status == "DISPATCH_IDENTIFIED"
    assert result.feasibility_verified
    assert len(result.charge_kw) == len(result.discharge_kw) == len(result.soc_pct) == 96
    assert all(not (charge > 1e-6 and discharge > 1e-6) for charge, discharge in zip(result.charge_kw, result.discharge_kw))
    assert all(grid >= -1e-6 for grid in result.optimized_grid_import_kw)
    assert result.final_soc_pct == pytest.approx(50, abs=1e-5)
    assert result.throughput_kwh <= 2000 + 1e-5
    assert result.net_indicative_benefit_inr == pytest.approx(
        result.gross_iex_component_reduction_inr - result.degradation_cost_inr, abs=1e-5)
    assert result.uncertainty_status == "ROBUST"


def test_flat_price_allows_zero_dispatch_without_forced_recommendation():
    result = solve_bess_behind_meter(request(prices_inr_per_mwh=[5000.0] * 96))
    assert result.status == "NO_ECONOMIC_BESS_DISPATCH_IDENTIFIED"
    assert result.feasibility_verified
    assert result.charge_blocks == result.discharge_blocks == []
    assert result.net_indicative_benefit_inr == 0


def test_no_export_constraint_is_fail_closed_across_central_schedule():
    result = solve_bess_behind_meter(request(forecast_load_kw=[100.0] * 96,
                                               forecast_lower_kw=[0.0] * 96,
                                               forecast_upper_kw=[200.0] * 96))
    assert all(value >= -1e-6 for value in result.optimized_grid_import_kw)
    if result.status == "DISPATCH_IDENTIFIED":
        assert result.uncertainty_status == "SENSITIVE_TO_FORECAST_UNCERTAINTY"


def test_minimum_final_soc_requires_explicit_bound():
    with pytest.raises(ValueError):
        request(final_soc_requirement="MINIMUM_FINAL_SOC", final_soc_percent=None)


def test_missing_intervals_report_insufficient_uncertainty_evidence():
    result = solve_bess_behind_meter(request(forecast_lower_kw=None, forecast_upper_kw=None))
    assert result.uncertainty_status == "INSUFFICIENT_FORECAST_INTERVAL_EVIDENCE"


def test_authenticated_fastapi_endpoint_uses_the_authoritative_contract():
    client = TestClient(app)
    payload = request().model_dump()
    assert client.post("/v1/bess/dispatch", json=payload).status_code == 401
    response = client.post("/v1/bess/dispatch", json=payload,
                           headers={"Authorization": "Bearer fixture-test-analytics-token"})
    assert response.status_code == 200
    body = response.json()
    assert body["solver_version"] == "BESS_BEHIND_METER_SCIPY_MILP_v1.0"
    assert len(body["baseline_load_kw"]) == len(body["optimized_grid_import_kw"]) == 96
