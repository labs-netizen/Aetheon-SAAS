"""Historical BESS sizing screen built exclusively on the Phase 3B MILP."""
from __future__ import annotations

import statistics
import time
from typing import Dict, List

from bess_dispatch import solve_bess_behind_meter
from schemas import (BESSBehindMeterRequest, BESSSizingCandidate, BESSSizingMarginal,
                     BESSSizingRequest, BESSSizingResponse)


def _profile_number(profile: Dict[str, object], key: str) -> float:
    value = profile.get(key)
    if not isinstance(value, (int, float)):
        raise ValueError(f"base_profile.{key} must be numeric")
    return float(value)


def _dispatch_request(req: BESSSizingRequest, capacity: float, power: float,
                      throughput: float) -> BESSBehindMeterRequest:
    profile = req.base_profile
    return BESSBehindMeterRequest(
        profile_id=f"{req.base_profile_id}:virtual:{capacity:g}:{power:g}", site_id=req.site_id,
        operating_date=req.operating_date, nameplate_energy_capacity_kwh=capacity,
        max_charge_power_kw=power, max_discharge_power_kw=power,
        minimum_soc_percent=_profile_number(profile, "minimum_soc_percent"),
        maximum_soc_percent=_profile_number(profile, "maximum_soc_percent"),
        initial_soc_percent=_profile_number(profile, "initial_soc_percent"),
        final_soc_requirement=str(profile.get("final_soc_requirement")),
        final_soc_percent=profile.get("final_soc_percent"),
        charge_efficiency_percent=_profile_number(profile, "charge_efficiency_percent"),
        discharge_efficiency_percent=_profile_number(profile, "discharge_efficiency_percent"),
        maximum_daily_throughput_kwh=throughput,
        degradation_cost_rs_per_kwh_throughput=_profile_number(profile, "degradation_cost_rs_per_kwh_throughput"),
        available_blocks=profile.get("available_blocks"), forecast_load_kw=req.forecast_load_kw,
        forecast_lower_kw=req.forecast_lower_kw, forecast_upper_kw=req.forecast_upper_kw,
        prices_inr_per_mwh=req.prices_inr_per_mwh, price_source_reference=req.price_source_reference,
        price_source_file_hash=req.price_source_file_hash, price_provenance_status=req.price_provenance_status,
        price_verification_status=req.price_verification_status, forecast_model_version=req.forecast_model_version,
        forecast_selected_model=req.forecast_selected_model, forecast_drift_status=req.forecast_drift_status,
    )


def _mark_pareto(candidates: List[dict]) -> None:
    tolerance = 1e-7
    for candidate in candidates:
        dominated = any(
            other is not candidate and other["capacity_kwh"] <= candidate["capacity_kwh"] and
            other["power_kw"] <= candidate["power_kw"] and
            other["net_indicative_benefit_inr"] + tolerance >= candidate["net_indicative_benefit_inr"] and
            (other["capacity_kwh"] < candidate["capacity_kwh"] or other["power_kw"] < candidate["power_kw"] or
             other["net_indicative_benefit_inr"] > candidate["net_indicative_benefit_inr"] + tolerance)
            for other in candidates
        )
        candidate["pareto_status"] = "DOMINATED" if dominated else "PARETO_EFFICIENT"


def _marginals(candidates: List[dict]) -> List[BESSSizingMarginal]:
    results: List[BESSSizingMarginal] = []
    for dimension, fixed_key, varied_key in (("CAPACITY", "power_kw", "capacity_kwh"),
                                              ("POWER", "capacity_kwh", "power_kw")):
        fixed_values = sorted({candidate[fixed_key] for candidate in candidates})
        for fixed in fixed_values:
            series = sorted((candidate for candidate in candidates if candidate[fixed_key] == fixed),
                            key=lambda candidate: candidate[varied_key])
            for previous, current in zip(series, series[1:]):
                increment = current[varied_key] - previous[varied_key]
                delta = current["net_indicative_benefit_inr"] - previous["net_indicative_benefit_inr"]
                results.append(BESSSizingMarginal(dimension=dimension, fixed_value=fixed,
                    from_value=previous[varied_key], to_value=current[varied_key],
                    incremental_net_benefit_inr=round(delta, 6),
                    incremental_benefit_per_unit_inr=round(delta / increment, 8)))
    return results


def solve_bess_sizing(req: BESSSizingRequest) -> BESSSizingResponse:
    started = time.perf_counter()
    base_capacity = _profile_number(req.base_profile, "nameplate_energy_capacity_kwh")
    base_throughput = _profile_number(req.base_profile, "maximum_daily_throughput_kwh")
    base_efc = base_throughput / (2 * base_capacity)
    if base_efc <= 0:
        raise ValueError("base maximum EFC per day must be positive")
    minimum_soc = _profile_number(req.base_profile, "minimum_soc_percent")
    maximum_soc = _profile_number(req.base_profile, "maximum_soc_percent")
    usable_fraction = (maximum_soc - minimum_soc) / 100
    candidates: List[dict] = []
    runtimes: List[float] = []

    for capacity in sorted(req.capacity_candidates_kwh):
        for power in sorted(req.power_candidates_kw):
            throughput_cap = 2 * capacity * base_efc
            candidate_started = time.perf_counter()
            dispatch = solve_bess_behind_meter(_dispatch_request(req, capacity, power, throughput_cap))
            runtime_ms = (time.perf_counter() - candidate_started) * 1000
            runtimes.append(runtime_ms)
            charged = sum(dispatch.charge_kw) * 0.25
            discharged = sum(dispatch.discharge_kw) * 0.25
            actual_soc_range = max(dispatch.soc_kwh) - min(dispatch.soc_kwh)
            allowed_usable_energy = capacity * usable_fraction
            net = dispatch.net_indicative_benefit_inr
            candidates.append(dict(
                capacity_kwh=capacity, power_kw=power, duration_hours=round(capacity / power, 6),
                energy_charged_kwh=round(charged, 6), energy_discharged_kwh=round(discharged, 6),
                throughput_kwh=dispatch.throughput_kwh, maximum_throughput_kwh=round(throughput_cap, 6),
                equivalent_full_cycles=dispatch.equivalent_full_cycles,
                minimum_soc_percent=dispatch.minimum_soc_pct_observed,
                maximum_soc_percent=dispatch.maximum_soc_pct_observed, final_soc_percent=dispatch.final_soc_pct,
                charge_power_utilization_percent=round(max(dispatch.charge_kw, default=0) / power * 100, 6),
                discharge_power_utilization_percent=round(max(dispatch.discharge_kw, default=0) / power * 100, 6),
                throughput_utilization_percent=round(dispatch.throughput_kwh / throughput_cap * 100, 6),
                usable_energy_utilization_percent=round(actual_soc_range / allowed_usable_energy * 100, 6)
                    if allowed_usable_energy > 0 else 0,
                baseline_iex_component_inr=dispatch.baseline_iex_component_inr,
                battery_iex_component_inr=dispatch.battery_iex_component_inr,
                gross_iex_component_reduction_inr=dispatch.gross_iex_component_reduction_inr,
                degradation_cost_inr=dispatch.degradation_cost_inr, net_indicative_benefit_inr=net,
                net_benefit_per_kwh_capacity=round(net / capacity, 8),
                net_benefit_per_kw_power=round(net / power, 8),
                no_action=dispatch.status == "NO_ECONOMIC_BESS_DISPATCH_IDENTIFIED",
                uncertainty_status=dispatch.uncertainty_status, drift_status=dispatch.drift_status,
                pareto_status="PARETO_EFFICIENT", solve_runtime_ms=round(runtime_ms, 6), dispatch=dispatch,
            ))

    _mark_pareto(candidates)
    best = max(candidates, key=lambda item: (item["net_indicative_benefit_inr"], -item["capacity_kwh"], -item["power_kw"]))
    best_per_kwh = max(candidates, key=lambda item: item["net_benefit_per_kwh_capacity"])
    best_per_kw = max(candidates, key=lambda item: item["net_benefit_per_kw_power"])
    threshold = best["net_indicative_benefit_inr"] * 0.9
    compact_pool = [item for item in candidates if item["net_indicative_benefit_inr"] >= threshold]
    compact = min(compact_pool, key=lambda item: (item["capacity_kwh"], item["power_kw"])) if compact_pool else None
    summary = lambda item: {"capacity_kwh": item["capacity_kwh"], "power_kw": item["power_kw"],
                            "net_indicative_benefit_inr": item["net_indicative_benefit_inr"]}

    leaders = []
    for scenario in ("CENTRAL", "LOWER", "UPPER"):
        scenario_candidates = [item for item in candidates if scenario in item["dispatch"].scenario_net_benefit_inr]
        if scenario_candidates:
            leader = max(scenario_candidates, key=lambda item: item["dispatch"].scenario_net_benefit_inr[scenario])
            leaders.append((leader["capacity_kwh"], leader["power_kw"]))
    uncertainty_result = "SIZING_RESULT_SENSITIVE_TO_FORECAST_UNCERTAINTY" if len(set(leaders)) > 1 else (
        "ROBUST" if leaders and all(item["uncertainty_status"] == "ROBUST" for item in candidates)
        else "INSUFFICIENT_INTERVAL_EVIDENCE")
    total_runtime = (time.perf_counter() - started) * 1000
    models = [BESSSizingCandidate(**item) for item in candidates]
    return BESSSizingResponse(site_id=req.site_id, operating_date=req.operating_date,
        base_profile_id=req.base_profile_id, base_max_efc_per_day=round(base_efc, 8),
        candidate_count=len(models), candidates=models, marginal_values=_marginals(candidates),
        best_candidate=summary(best), best_per_kwh_candidate=summary(best_per_kwh),
        best_per_kw_candidate=summary(best_per_kw), compact_value_candidate=summary(compact) if compact else None,
        pareto_efficient_count=sum(item["pareto_status"] == "PARETO_EFFICIENT" for item in candidates),
        dominated_count=sum(item["pareto_status"] == "DOMINATED" for item in candidates),
        uncertainty_result=uncertainty_result, total_runtime_ms=round(total_runtime, 6),
        median_candidate_runtime_ms=round(statistics.median(runtimes), 6))
