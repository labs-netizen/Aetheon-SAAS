"""
Deterministic numerical engines and solvers for Aetheon Analytics.
Provides 96-block forecasting heuristics, DSM deviation arithmetic, and BESS advisory solvers.
"""

from datetime import datetime, timezone
import math
import numpy as np
from typing import List, Tuple
from schemas import (
    GridForecastRequest, GridForecastResponse, GridForecastBlock,
    DSMCalculationRequest, DSMCalculationResponse, DSMDeviationBlock,
    BESSSolverRequest, BESSSolverResponse, BESSDispatchBlock,
    RenewableReconciliationRequest, RenewableReconciliationResponse
)


def get_block_times(block_idx: int) -> Tuple[str, str]:
    """Return HH:MM start and end times for block 1 to 96."""
    start_minutes = (block_idx - 1) * 15
    end_minutes = block_idx * 15
    
    start_h = start_minutes // 60
    start_m = start_minutes % 60
    end_h = end_minutes // 60
    end_m = end_minutes % 60
    
    start_str = f"{start_h:02d}:{start_m:02d}"
    end_str = "24:00" if end_h == 24 else f"{end_h:02d}:{end_m:02d}"
    return start_str, end_str


def solve_grid_forecast(req: GridForecastRequest) -> GridForecastResponse:
    """Deterministic 96-block load and day-ahead clearing price forecast."""
    if not req.is_demo:
        return GridForecastResponse(
            site_id=req.site_id, operating_date=req.operating_date,
            model_version="LIVE_MODEL_UNAVAILABLE", model_generation_time=datetime.now(timezone.utc).isoformat(),
            blocks=[], is_suppressed=True, suppression_reason="LIVE_MODEL_AND_PRICE_FEED_REQUIRED",
            data_quality="UNVERIFIED", freshness="UNKNOWN", confidence_status="UNAVAILABLE")
    np.random.seed(req.seed or 42)
    blocks: List[GridForecastBlock] = []
    
    total_price = 0.0
    peak_demand = 0.0
    peak_block = 1
    
    for b in range(1, 97):
        start_t, end_t = get_block_times(b)
        
        # Diurnal C&I load curve modeling: morning ramp up (blocks 32-48), evening peak (blocks 72-88)
        hour = (b - 1) / 4.0
        load_diurnal = 0.65 + 0.25 * math.sin((hour - 6) * math.pi / 12.0)
        if 9.0 <= hour <= 13.0:
            load_diurnal += 0.1  # Midday factory operations
        elif 18.0 <= hour <= 22.0:
            load_diurnal += 0.05 # Evening lighting/shift
            
        base_kw = req.contract_demand_kw * max(0.4, min(0.95, load_diurnal))
        noise = (np.random.rand() - 0.5) * 0.04 * req.contract_demand_kw
        forecast_kw = round(float(base_kw + noise), 2)
        
        # Indian Day-Ahead Market (DAM) price shape: higher during morning (8-10am) & evening peak (6-10pm)
        if 32 <= b <= 44:  # 08:00 - 11:00
            price_base = 5200.0 + (b - 32) * 120.0
        elif 72 <= b <= 88: # 18:00 - 22:00
            price_base = 6500.0 + math.sin((b - 72) / 16.0 * math.pi) * 2200.0
        elif 1 <= b <= 24:   # Night hours
            price_base = 2800.0 + (b % 5) * 40.0
        else:
            price_base = 4200.0 + (b % 7) * 50.0
            
        forecast_price = round(float(price_base + (np.random.rand() - 0.5) * 200.0), 2)
        is_high_cost = forecast_price > 5800.0
        
        if forecast_kw > peak_demand:
            peak_demand = forecast_kw
            peak_block = b
            
        total_price += forecast_price
        
        blocks.append(GridForecastBlock(
            block_index=b,
            start_time=start_t,
            end_time=end_t,
            forecast_demand_kw=forecast_kw,
            forecast_price_inr_per_mwh=forecast_price,
            confidence_lower_kw=round(forecast_kw * 0.94, 2),
            confidence_upper_kw=round(forecast_kw * 1.06, 2),
            is_high_cost_window=is_high_cost
        ))
        
    return GridForecastResponse(
        site_id=req.site_id,
        operating_date=req.operating_date,
        model_generation_time=datetime.now(timezone.utc).isoformat(),
        average_price_inr_per_mwh=round(total_price / 96.0, 2),
        peak_demand_kw=peak_demand,
        peak_demand_block=peak_block,
        blocks=blocks
    )


def solve_dsm_deviation(req: DSMCalculationRequest) -> DSMCalculationResponse:
    """Compute technical deviations. The demonstration bands are not regulatory limits."""
    blocks: List[DSMDeviationBlock] = []
    total_dev_kwh = 0.0
    max_pos = 0.0
    max_neg = 0.0
    watch_count = 0
    high_count = 0
    critical_count = 0
    total_penalty = 0.0
    
    for b in range(1, 97):
        sched = req.scheduled_drawal_kw[b - 1]
        act = req.actual_drawal_kw[b - 1]
        dev_kw = act - sched
        
        # 15-minute energy in kWh = kW * 0.25h
        total_dev_kwh += abs(dev_kw) * 0.25
        
        if dev_kw > max_pos:
            max_pos = dev_kw
        if dev_kw < max_neg:
            max_neg = dev_kw
            
        pct = round(dev_kw / sched * 100.0, 2) if sched > 0 else (0.0 if act == 0 else None)
        risk_pct = abs(dev_kw) / sched * 100.0 if sched > 0 else (0.0 if act == 0 else math.inf)
        
        if risk_pct < 4.0:
            risk = "NORMAL"
            penalty = 0.0
        elif risk_pct < 8.0:
            risk = "WATCH"
            watch_count += 1
            penalty = abs(dev_kw) * 0.25 * 3.5  # DEMO rate: ₹3.5/kWh on excess
        elif risk_pct < 12.0:
            risk = "HIGH"
            high_count += 1
            penalty = abs(dev_kw) * 0.25 * 7.5  # DEMO rate: ₹7.5/kWh
        else:
            risk = "CRITICAL"
            critical_count += 1
            penalty = abs(dev_kw) * 0.25 * 14.0 # DEMO rate: ₹14.0/kWh surcharge
            
        total_penalty += penalty
        blocks.append(DSMDeviationBlock(
            block_index=b,
            scheduled_drawal_kw=sched,
            actual_drawal_kw=act,
            deviation_kw=dev_kw,
            deviation_pct=pct,
            risk_level=risk,
            estimated_penalty_inr=round(penalty, 2) if req.is_demo else None
        ))
        
    return DSMCalculationResponse(
        site_id=req.site_id,
        operating_date=req.operating_date,
        total_deviation_kwh=round(total_dev_kwh, 2),
        max_positive_deviation_kw=round(max_pos, 2),
        max_negative_deviation_kw=round(max_neg, 2),
        blocks_in_watch=watch_count,
        blocks_in_high=high_count,
        blocks_in_critical=critical_count,
        estimated_total_exposure_inr=round(total_penalty, 2) if req.is_demo else None,
        rule_version="CERC_DSM_2024_DEMO" if req.is_demo else "REGULATORY_CONFIGURATION_REQUIRED",
        monetary_exposure_status="DEMO_CALCULATION" if req.is_demo else "REGULATORY_CONFIGURATION_REQUIRED",
        blocks=blocks
    )


def solve_bess_advisory(req: BESSSolverRequest) -> BESSSolverResponse:
    """Conservative AC-side heuristic, with energy balance and terminal inventory checks."""
    def suppressed(reason, feasible=False):
        return BESSSolverResponse(battery_id=req.battery_id, site_id=req.site_id, operating_date=req.operating_date,
            solver_version="BESS_AC_HEURISTIC_DEMO_v2.0" if req.is_demo else "BESS_AC_HEURISTIC_v2.0",
            is_feasibility_verified=feasible, is_suppressed=True, suppression_reason=reason,
            gross_arbitrage_value_inr=0, estimated_degradation_cost_inr=0, net_opportunity_value_inr=0,
            cycles_equivalent=0, blocks=[])

    if req.maintenance_lock_active or req.telemetry_stale or req.interconnection_restricted:
        return suppressed("SAFETY_INTERLOCK")
    if not req.is_demo:
        return suppressed("LIVE_PRICE_AND_INTERCONNECTION_AUTHORITY_REQUIRED")
    prices = req.prices_inr_per_mwh
    if not all(math.isfinite(v) for v in prices):
        return suppressed("INVALID_PRICES")
    low, high = np.percentile(prices, [25, 75])
    if high <= low:
        return suppressed("NO_VERIFIED_ECONOMIC_OPPORTUNITY", True)
    initial = req.usable_capacity_kwh * req.initial_soc_pct / 100
    energy = initial
    minimum = req.usable_capacity_kwh * req.min_soc_pct / 100
    maximum = req.usable_capacity_kwh * req.max_soc_pct / 100
    total_cost = total_revenue = throughput = 0.0
    blocks = []
    for idx, price in enumerate(prices):
        action, power, cost, revenue = "IDLE", 0.0, 0.0, 0.0
        # Reserve initial inventory; profits must not count its liquidation as free energy.
        if price <= low and energy < maximum and any(p >= high for p in prices[idx+1:]):
            power = min(req.power_rating_kw, (maximum-energy)/(0.25*req.charge_efficiency))
            stored = power*0.25*req.charge_efficiency
            energy += stored
            throughput += stored
            cost = power*0.25*price/1000
            action = "CHARGE"
        elif price >= high and energy > initial:
            power = min(req.power_rating_kw, (energy-initial)*req.discharge_efficiency/0.25)
            extracted = power*0.25/req.discharge_efficiency
            energy -= extracted
            throughput += extracted
            revenue = power*0.25*price/1000
            action = "DISCHARGE"
        if not minimum-1e-7 <= energy <= maximum+1e-7 or not 0 <= power <= req.power_rating_kw+1e-7:
            return suppressed("INFEASIBLE_DISPATCH")
        total_cost += cost
        total_revenue += revenue
        blocks.append(BESSDispatchBlock(block_index=idx+1, recommended_action=action, power_kw=round(power,8),
            resulting_soc_pct=round(energy/req.usable_capacity_kwh*100,8),
            marginal_cost_inr=round(cost,8), marginal_revenue_inr=round(revenue,8)))
    if abs(energy-initial) > 1e-6:
        return suppressed("TERMINAL_SOC_NOT_RESTORED")
    cycles = throughput/(2*req.usable_capacity_kwh)
    degradation = cycles*req.degradation_cost_per_cycle_inr
    gross = total_revenue-total_cost
    if not all(math.isfinite(v) for v in [cycles, degradation, gross]):
        return suppressed("NONFINITE_ECONOMICS")
    if gross-degradation <= 0:
        return suppressed("NO_VERIFIED_ECONOMIC_OPPORTUNITY", True)
    return BESSSolverResponse(battery_id=req.battery_id, site_id=req.site_id, operating_date=req.operating_date,
        solver_version="BESS_AC_HEURISTIC_DEMO_v2.0" if req.is_demo else "BESS_AC_HEURISTIC_v2.0",
        is_feasibility_verified=True, gross_arbitrage_value_inr=round(gross,2),
        estimated_degradation_cost_inr=round(degradation,2), net_opportunity_value_inr=round(gross-degradation,2),
        cycles_equivalent=round(cycles,8), blocks=blocks)


def solve_renewable_reconciliation(req: RenewableReconciliationRequest) -> RenewableReconciliationResponse:
    """Reconcile measured vs modelled solar generation and compute avoided carbon emissions."""
    measured_total = sum(req.measured_generation_kwh)
    
    # Modelled bell curve generation for Solar PV in India (blocks 25 to 75, ~06:00 to 18:30)
    modelled_total = 0.0
    for b in range(1, 97):
        if 25 <= b <= 74:
            t = (b - 25) / 49.0
            solar_irradiance = math.sin(t * math.pi)
            modelled_step = req.installed_capacity_kw * 0.25 * 0.78 * solar_irradiance
            modelled_total += modelled_step
            
    pr = round((measured_total / modelled_total * 100.0), 2) if modelled_total > 0 else 0.0
    avoided_co2 = round((measured_total / 1000.0) * req.grid_emission_factor_tco2e_per_mwh, 3)
    
    return RenewableReconciliationResponse(
        site_id=req.site_id,
        operating_date=req.operating_date,
        total_measured_generation_kwh=round(measured_total, 2),
        total_modelled_generation_kwh=round(modelled_total, 2),
        performance_ratio_pct=pr,
        avoided_emissions_tco2e=avoided_co2
    )
