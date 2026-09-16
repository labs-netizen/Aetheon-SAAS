"""Behind-the-meter BESS advisory simulation using a mixed-integer linear program."""
from __future__ import annotations

import math
import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp

from schemas import BESSBehindMeterRequest, BESSBehindMeterResponse

BLOCKS = 96
DT_HOURS = 0.25
TOL = 1e-6


def _suppressed(req: BESSBehindMeterRequest, reason: str) -> BESSBehindMeterResponse:
    initial_kwh = req.nameplate_energy_capacity_kwh * req.initial_soc_percent / 100
    zero = [0.0] * BLOCKS
    baseline = sum(load * DT_HOURS * price / 1000 for load, price in zip(req.forecast_load_kw, req.prices_inr_per_mwh))
    return BESSBehindMeterResponse(
        profile_id=req.profile_id, site_id=req.site_id, operating_date=req.operating_date,
        status="SUPPRESSED", suppression_reason=reason, feasibility_verified=False,
        uncertainty_status="INSUFFICIENT_FORECAST_INTERVAL_EVIDENCE", drift_status=req.forecast_drift_status,
        baseline_load_kw=req.forecast_load_kw, optimized_grid_import_kw=req.forecast_load_kw,
        charge_kw=zero, discharge_kw=zero, soc_kwh=[initial_kwh] * BLOCKS,
        soc_pct=[req.initial_soc_percent] * BLOCKS, mcp_inr_per_mwh=req.prices_inr_per_mwh,
        baseline_iex_component_inr=round(baseline, 6), battery_iex_component_inr=round(baseline, 6),
        gross_iex_component_reduction_inr=0, degradation_cost_inr=0, net_indicative_benefit_inr=0,
        throughput_kwh=0, equivalent_full_cycles=0, minimum_soc_pct_observed=req.initial_soc_percent,
        maximum_soc_pct_observed=req.initial_soc_percent, final_soc_pct=req.initial_soc_percent,
        charge_blocks=[], discharge_blocks=[], scenario_net_benefit_inr={},
        profile=_profile(req), provenance=_provenance(req),
    )


def _profile(req: BESSBehindMeterRequest) -> dict:
    return {key: value for key, value in req.model_dump().items() if key in {
        "nameplate_energy_capacity_kwh", "max_charge_power_kw", "max_discharge_power_kw", "minimum_soc_percent",
        "maximum_soc_percent", "initial_soc_percent", "final_soc_requirement", "final_soc_percent",
        "charge_efficiency_percent", "discharge_efficiency_percent", "maximum_daily_throughput_kwh",
        "degradation_cost_rs_per_kwh_throughput", "available_blocks"
    }}


def _provenance(req: BESSBehindMeterRequest) -> dict:
    return {
        "price_source_reference": req.price_source_reference,
        "price_source_file_hash": req.price_source_file_hash,
        "price_provenance_status": req.price_provenance_status,
        "price_verification_status": req.price_verification_status,
        "forecast_model_version": req.forecast_model_version,
        "forecast_selected_model": req.forecast_selected_model,
        "forecast_drift_status": req.forecast_drift_status,
    }


def solve_bess_behind_meter(req: BESSBehindMeterRequest) -> BESSBehindMeterResponse:
    """Optimize AC-side grid import; binary variables prevent simultaneous charge/discharge."""
    numeric = req.forecast_load_kw + req.prices_inr_per_mwh
    if not all(math.isfinite(value) for value in numeric):
        return _suppressed(req, "INVALID_NUMERICAL_INPUT")

    eta_c = req.charge_efficiency_percent / 100
    eta_d = req.discharge_efficiency_percent / 100
    capacity = req.nameplate_energy_capacity_kwh
    initial = capacity * req.initial_soc_percent / 100
    minimum = capacity * req.minimum_soc_percent / 100
    maximum = capacity * req.maximum_soc_percent / 100
    n = BLOCKS * 4
    charge = np.arange(0, BLOCKS)
    discharge = np.arange(BLOCKS, BLOCKS * 2)
    soc = np.arange(BLOCKS * 2, BLOCKS * 3)
    mode = np.arange(BLOCKS * 3, BLOCKS * 4)

    objective = np.zeros(n)
    prices = np.asarray(req.prices_inr_per_mwh, dtype=float)
    deg = req.degradation_cost_rs_per_kwh_throughput
    objective[charge] = DT_HOURS * (prices / 1000 + deg)
    objective[discharge] = DT_HOURS * (-prices / 1000 + deg)

    lower = np.zeros(n)
    upper = np.full(n, np.inf)
    upper[charge] = req.max_charge_power_kw
    upper[discharge] = req.max_discharge_power_kw
    upper[soc] = maximum
    lower[soc] = minimum
    upper[mode] = 1
    available = set(req.available_blocks or range(1, BLOCKS + 1))
    for index in range(BLOCKS):
        if index + 1 not in available:
            upper[charge[index]] = upper[discharge[index]] = 0

    rows, lows, highs = [], [], []
    for index in range(BLOCKS):
        balance = np.zeros(n)
        balance[soc[index]] = 1
        if index:
            balance[soc[index - 1]] = -1
            rhs = 0
        else:
            rhs = initial
        balance[charge[index]] = -DT_HOURS * eta_c
        balance[discharge[index]] = DT_HOURS / eta_d
        rows.append(balance); lows.append(rhs); highs.append(rhs)

        charge_mode = np.zeros(n); charge_mode[charge[index]] = 1; charge_mode[mode[index]] = -req.max_charge_power_kw
        rows.append(charge_mode); lows.append(-np.inf); highs.append(0)
        discharge_mode = np.zeros(n); discharge_mode[discharge[index]] = 1; discharge_mode[mode[index]] = req.max_discharge_power_kw
        rows.append(discharge_mode); lows.append(-np.inf); highs.append(req.max_discharge_power_kw)
        no_export = np.zeros(n); no_export[charge[index]] = -1; no_export[discharge[index]] = 1
        rows.append(no_export); lows.append(-np.inf); highs.append(req.forecast_load_kw[index])

    throughput = np.zeros(n); throughput[charge] = DT_HOURS; throughput[discharge] = DT_HOURS
    rows.append(throughput); lows.append(-np.inf); highs.append(req.maximum_daily_throughput_kwh)
    terminal = np.zeros(n); terminal[soc[-1]] = 1
    if req.final_soc_requirement == "RETURN_TO_INITIAL_SOC":
        rows.append(terminal); lows.append(initial); highs.append(initial)
    else:
        rows.append(terminal); lows.append(capacity * float(req.final_soc_percent) / 100); highs.append(np.inf)

    result = milp(objective, integrality=np.r_[np.zeros(BLOCKS * 3), np.ones(BLOCKS)],
                  bounds=Bounds(lower, upper), constraints=LinearConstraint(np.asarray(rows), lows, highs),
                  options={"time_limit": 20})
    if not result.success or result.x is None:
        return _suppressed(req, "INFEASIBLE_BESS_PROFILE_OR_DISPATCH")

    c = np.where(result.x[charge] < TOL, 0, result.x[charge])
    d = np.where(result.x[discharge] < TOL, 0, result.x[discharge])
    s = result.x[soc]
    grid = np.asarray(req.forecast_load_kw) + c - d
    throughput_kwh = float(np.sum((c + d) * DT_HOURS))
    baseline = float(np.sum(np.asarray(req.forecast_load_kw) * DT_HOURS * prices / 1000))
    battery_component = float(np.sum(grid * DT_HOURS * prices / 1000))
    gross = baseline - battery_component
    degradation = throughput_kwh * deg
    net = gross - degradation
    if net <= TOL or not np.any(c + d > TOL):
        response = _suppressed(req, "NO_ECONOMIC_BESS_DISPATCH_IDENTIFIED")
        return response.model_copy(update={"status": "NO_ECONOMIC_BESS_DISPATCH_IDENTIFIED", "feasibility_verified": True})

    scenarios = {}
    uncertainty = "INSUFFICIENT_FORECAST_INTERVAL_EVIDENCE"
    if req.forecast_lower_kw is not None and req.forecast_upper_kw is not None:
        feasible_all = True
        for name, loads in (("CENTRAL", req.forecast_load_kw), ("LOWER", req.forecast_lower_kw), ("UPPER", req.forecast_upper_kw)):
            scenario_grid = np.asarray(loads) + c - d
            feasible_all &= bool(np.all(scenario_grid >= -TOL))
            scenario_baseline = float(np.sum(np.asarray(loads) * DT_HOURS * prices / 1000))
            scenario_battery = float(np.sum(scenario_grid * DT_HOURS * prices / 1000))
            scenarios[name] = round(scenario_baseline - scenario_battery - degradation, 6)
        uncertainty = "ROBUST" if feasible_all and min(scenarios.values()) > TOL else "SENSITIVE_TO_FORECAST_UNCERTAINTY"

    return BESSBehindMeterResponse(
        profile_id=req.profile_id, site_id=req.site_id, operating_date=req.operating_date,
        status="DISPATCH_IDENTIFIED", feasibility_verified=True, uncertainty_status=uncertainty,
        drift_status=req.forecast_drift_status, baseline_load_kw=[round(v, 6) for v in req.forecast_load_kw],
        optimized_grid_import_kw=[round(v, 6) for v in grid], charge_kw=[round(v, 6) for v in c],
        discharge_kw=[round(v, 6) for v in d], soc_kwh=[round(v, 6) for v in s],
        soc_pct=[round(v / capacity * 100, 6) for v in s], mcp_inr_per_mwh=req.prices_inr_per_mwh,
        baseline_iex_component_inr=round(baseline, 6), battery_iex_component_inr=round(battery_component, 6),
        gross_iex_component_reduction_inr=round(gross, 6), degradation_cost_inr=round(degradation, 6),
        net_indicative_benefit_inr=round(net, 6), throughput_kwh=round(throughput_kwh, 6),
        equivalent_full_cycles=round(throughput_kwh / (2 * capacity), 8),
        minimum_soc_pct_observed=round(float(np.min(s)) / capacity * 100, 6),
        maximum_soc_pct_observed=round(float(np.max(s)) / capacity * 100, 6),
        final_soc_pct=round(float(s[-1]) / capacity * 100, 6),
        charge_blocks=[i + 1 for i, value in enumerate(c) if value > TOL],
        discharge_blocks=[i + 1 for i, value in enumerate(d) if value > TOL],
        scenario_net_benefit_inr=scenarios, profile=_profile(req), provenance=_provenance(req),
    )
