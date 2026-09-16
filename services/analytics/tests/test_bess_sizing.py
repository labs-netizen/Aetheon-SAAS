import pytest
from pydantic import ValidationError

from bess_sizing import solve_bess_sizing
from schemas import BESSSizingRequest

CAPACITIES = [500, 1000, 1500, 2000, 3000, 4000]
POWERS = [250, 500, 750, 1000]


def request(**overrides):
    values = dict(site_id="site-1", operating_date="2026-05-01", base_profile_id="site-1",
        base_profile=dict(nameplate_energy_capacity_kwh=2000, max_charge_power_kw=500,
            max_discharge_power_kw=500, minimum_soc_percent=20, maximum_soc_percent=90,
            initial_soc_percent=48, final_soc_requirement="RETURN_TO_INITIAL_SOC", final_soc_percent=None,
            charge_efficiency_percent=95, discharge_efficiency_percent=95,
            maximum_daily_throughput_kwh=2000, degradation_cost_rs_per_kwh_throughput=.5,
            available_blocks=None), capacity_candidates_kwh=CAPACITIES, power_candidates_kw=POWERS,
        forecast_load_kw=[10000.0] * 96, forecast_lower_kw=[9000.0] * 96,
        forecast_upper_kw=[11000.0] * 96,
        prices_inr_per_mwh=[2500.0] * 32 + [5000.0] * 32 + [9000.0] * 32,
        price_source_reference="IEX DAM fixture", price_source_file_hash="a" * 64,
        price_provenance_status="OFFICIAL_SOURCE_CONFIRMED", price_verification_status="VERIFIED",
        forecast_model_version="GRID_HISTORICAL_LOAD_V2.0", forecast_selected_model="RIDGE",
        forecast_drift_status="NORMAL")
    values.update(overrides)
    return BESSSizingRequest(**values)


@pytest.fixture(scope="module")
def result():
    return solve_bess_sizing(request())


def test_24_candidate_screen_reuses_physical_dispatch_and_normalizes_throughput(result):
    assert result.candidate_count == 24
    assert result.base_max_efc_per_day == .5
    for candidate in result.candidates:
        assert candidate.maximum_throughput_kwh == pytest.approx(candidate.capacity_kwh)
        assert candidate.throughput_kwh <= candidate.maximum_throughput_kwh + 1e-5
        assert candidate.final_soc_percent == pytest.approx(48, abs=1e-4)
        assert all(value >= -1e-6 for value in candidate.dispatch.optimized_grid_import_kw)
        assert all(not (charge > 1e-6 and discharge > 1e-6)
                   for charge, discharge in zip(candidate.dispatch.charge_kw, candidate.dispatch.discharge_kw))
        assert candidate.net_indicative_benefit_inr == pytest.approx(
            candidate.gross_iex_component_reduction_inr - candidate.degradation_cost_inr, abs=1e-5)
        profile = candidate.dispatch.profile
        assert profile["minimum_soc_percent"] == 20
        assert profile["maximum_soc_percent"] == 90
        assert profile["initial_soc_percent"] == 48
        assert profile["charge_efficiency_percent"] == profile["discharge_efficiency_percent"] == 95
        assert profile["degradation_cost_rs_per_kwh_throughput"] == .5


def test_result_has_objective_frontier_compact_and_marginal_evidence(result):
    assert result.pareto_efficient_count + result.dominated_count == 24
    assert result.pareto_efficient_count > 0
    assert result.dominated_count > 0
    assert result.best_candidate["net_indicative_benefit_inr"] == max(c.net_indicative_benefit_inr for c in result.candidates)
    assert result.compact_value_candidate["net_indicative_benefit_inr"] >= .9 * result.best_candidate["net_indicative_benefit_inr"]
    capacity_marginals = [item for item in result.marginal_values if item.dimension == "CAPACITY"]
    power_marginals = [item for item in result.marginal_values if item.dimension == "POWER"]
    assert len(capacity_marginals) == 20
    assert len(power_marginals) == 18


def test_zero_dispatch_candidates_are_valid():
    result = solve_bess_sizing(request(capacity_candidates_kwh=[500], power_candidates_kw=[250],
        prices_inr_per_mwh=[5000.0] * 96))
    assert result.candidates[0].no_action
    assert result.candidates[0].net_indicative_benefit_inr == 0


def test_deterministic_results():
    small = request(capacity_candidates_kwh=[500, 1000], power_candidates_kw=[250])
    first = solve_bess_sizing(small)
    second = solve_bess_sizing(small)
    assert [(c.capacity_kwh, c.power_kw, c.net_indicative_benefit_inr, c.pareto_status) for c in first.candidates] == [
        (c.capacity_kwh, c.power_kw, c.net_indicative_benefit_inr, c.pareto_status) for c in second.candidates]


@pytest.mark.parametrize("overrides", [
    dict(capacity_candidates_kwh=[]), dict(power_candidates_kw=[]),
    dict(capacity_candidates_kwh=[0]), dict(power_candidates_kw=[-1]),
    dict(capacity_candidates_kwh=list(range(1, 7)), power_candidates_kw=list(range(1, 7))),
    dict(capacity_candidates_kwh=[500, 500]),
])
def test_invalid_candidate_arrays_fail_closed(overrides):
    with pytest.raises(ValidationError):
        request(**overrides)


def test_exact_verified_price_contract_is_required():
    with pytest.raises(ValidationError):
        request(prices_inr_per_mwh=[1000] * 95)
    with pytest.raises(ValidationError):
        request(price_verification_status="UNVERIFIED")


def test_single_day_safety_contract_and_no_investment_math(result):
    assert result.analyzed_days == 1
    assert result.evidence_warning == "SINGLE-DAY HISTORICAL SIZING SCREEN — NOT SUFFICIENT FOR INVESTMENT SIZING"
    assert "NOT AN INVESTMENT RECOMMENDATION" in result.safety_disclaimer
    serialized = result.model_dump_json()
    assert 'annualized' not in serialized.lower()
    assert 'recommended battery' not in serialized.lower()
    for forbidden in ('roi', 'payback', 'npv', 'irr'):
        assert forbidden not in serialized.lower()
