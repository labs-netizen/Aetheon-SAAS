import math
import os
import sys
import pytest
from pydantic import ValidationError

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from schemas import GridForecastRequest, DSMCalculationRequest, BESSSolverRequest
from solvers import solve_grid_forecast, solve_dsm_deviation, solve_bess_advisory


def bess(**overrides):
    values = dict(is_demo=True, battery_id='battery', site_id='site', operating_date='2026-09-07',
        usable_capacity_kwh=1000, power_rating_kw=500, initial_soc_pct=30, min_soc_pct=10, max_soc_pct=90,
        charge_efficiency=0.8, discharge_efficiency=0.75, degradation_cost_per_cycle_inr=100,
        prices_inr_per_mwh=[1000.0]*48+[10000.0]*48)
    return BESSSolverRequest(**(values | overrides))


def test_live_grid_never_fabricates_forecast_even_with_history():
    r = solve_grid_forecast(GridForecastRequest(site_id='site',operating_date='2026-09-07',
        contract_demand_kw=1000,historical_load_kw=[1000]*96))
    assert r.is_suppressed and not r.blocks
    assert r.average_price_inr_per_mwh is None and r.confidence_status == 'UNAVAILABLE'


def test_demo_grid_truth_and_block_alignment():
    r = solve_grid_forecast(GridForecastRequest(is_demo=True,site_id='site',operating_date='2026-09-07',contract_demand_kw=1000))
    assert r.data_quality == 'DEMO_UNVERIFIED' and r.confidence_status == 'DEMO_UNCALIBRATED'
    assert r.blocks[0].start_time == '00:00' and r.blocks[-1].end_time == '24:00'
    assert [b.block_index for b in r.blocks] == list(range(1,97))


def test_zero_schedule_drawal_is_critical_and_exposure_unknown():
    r = solve_dsm_deviation(DSMCalculationRequest(site_id='site',operating_date='2026-09-07',
        contract_demand_kw=1,scheduled_drawal_kw=[0]*96,actual_drawal_kw=[100]*96))
    assert r.blocks_in_critical == 96 and r.blocks[0].deviation_pct is None
    assert r.total_deviation_kwh == 2400 and r.estimated_total_exposure_inr is None
    assert all(b.estimated_penalty_inr is None for b in r.blocks)


def test_dsm_signed_deviation_and_unrounded_thresholds():
    actual = [1000]*96
    actual[0] = 850
    actual[1] = 1039.999
    r = solve_dsm_deviation(DSMCalculationRequest(site_id='site',operating_date='2026-09-07',
        contract_demand_kw=1,scheduled_drawal_kw=[1000]*96,actual_drawal_kw=actual))
    assert r.blocks[0].deviation_pct == -15 and r.blocks[0].risk_level == 'CRITICAL'
    assert r.blocks[1].risk_level == 'NORMAL'
    assert r.total_deviation_kwh == round((150+39.999)*0.25,2)


@pytest.mark.parametrize('value', [-1, math.nan, math.inf, -math.inf])
def test_invalid_drawal_is_rejected(value):
    with pytest.raises(ValidationError):
        DSMCalculationRequest(site_id='site',operating_date='2026-09-07',contract_demand_kw=1,
            scheduled_drawal_kw=[value]*96,actual_drawal_kw=[1]*96)


@pytest.mark.parametrize('key,value', [('prices_inr_per_mwh',[math.nan]*96),('charge_efficiency',0),
    ('discharge_efficiency',1.1),('power_rating_kw',math.inf),('initial_soc_pct',9),('operating_date','2026-02-31')])
def test_invalid_bess_inputs_are_rejected(key,value):
    with pytest.raises(ValidationError):
        bess(**{key:value})


@pytest.mark.parametrize('lock', ['maintenance_lock_active','telemetry_stale','interconnection_restricted'])
def test_bess_interlocks_precede_optimisation(lock):
    r = solve_bess_advisory(bess(**{lock:True}))
    assert r.is_suppressed and not r.is_feasibility_verified and not r.blocks


def test_bess_live_authority_is_required():
    r = solve_bess_advisory(bess(is_demo=False))
    assert r.is_suppressed and not r.blocks


def test_bess_ac_energy_balance_and_economic_accounting():
    req = bess()
    r = solve_bess_advisory(req)
    assert not r.is_suppressed and r.is_feasibility_verified and len(r.blocks)==96
    energy = 300.0
    cost = revenue = throughput = 0.0
    for i,b in enumerate(r.blocks):
        assert 0 <= b.power_kw <= req.power_rating_kw
        if b.recommended_action == 'CHARGE':
            stored = b.power_kw*0.25*req.charge_efficiency
            energy += stored
            throughput += stored
            cost += b.power_kw*0.25*req.prices_inr_per_mwh[i]/1000
        elif b.recommended_action == 'DISCHARGE':
            extracted = b.power_kw*0.25/req.discharge_efficiency
            energy -= extracted
            throughput += extracted
            revenue += b.power_kw*0.25*req.prices_inr_per_mwh[i]/1000
        else:
            assert b.recommended_action == 'IDLE' and b.power_kw == 0
        assert energy/10 == pytest.approx(b.resulting_soc_pct,abs=1e-6)
        assert 100-1e-6 <= energy <= 900+1e-6
    assert energy == pytest.approx(300,abs=1e-6)
    cycles = throughput/2000
    assert r.cycles_equivalent == pytest.approx(cycles,abs=1e-6)
    assert r.net_opportunity_value_inr == pytest.approx(revenue-cost-cycles*100,abs=0.01)


@pytest.mark.parametrize('overrides', [dict(prices_inr_per_mwh=[5000]*96),
    dict(degradation_cost_per_cycle_inr=100000),dict(prices_inr_per_mwh=[10000]*48+[1000]*48),
    dict(power_rating_kw=1,prices_inr_per_mwh=[1000]*95+[10000])])
def test_nonprofitable_or_unrestored_inventory_suppresses_advisory(overrides):
    r = solve_bess_advisory(bess(**overrides))
    assert r.is_suppressed and not r.blocks
