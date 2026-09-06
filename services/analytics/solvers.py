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
    """Calculate 96-block deviations and classify risk under CERC/SERC DSM guidelines."""
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
        dev_kw = round(act - sched, 2)
        
        # 15-minute energy in kWh = kW * 0.25h
        total_dev_kwh += abs(dev_kw) * 0.25
        
        if dev_kw > max_pos:
            max_pos = dev_kw
        if dev_kw < max_neg:
            max_neg = dev_kw
            
        pct = round(abs(dev_kw) / sched * 100.0, 2) if sched > 0 else 0.0
        
        if pct < 4.0:
            risk = "NORMAL"
            penalty = 0.0
        elif pct < 8.0:
            risk = "WATCH"
            watch_count += 1
            penalty = abs(dev_kw) * 0.25 * 3.5  # DEMO rate: ₹3.5/kWh on excess
        elif pct < 12.0:
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
            estimated_penalty_inr=round(penalty, 2)
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
        estimated_total_exposure_inr=round(total_penalty, 2),
        blocks=blocks
    )


def solve_bess_advisory(req: BESSSolverRequest) -> BESSSolverResponse:
    """
    Feasible deterministic reference solver for BESS opportunity windows.
    Enforces capacity bounds, power limits, SOC limits, and efficiency losses.
    """
    # Identify price percentiles
    p_low = np.percentile(req.prices_inr_per_mwh, 25)
    p_high = np.percentile(req.prices_inr_per_mwh, 75)
    
    current_soc_kwh = req.usable_capacity_kwh * (req.initial_soc_pct / 100.0)
    min_soc_kwh = req.usable_capacity_kwh * (req.min_soc_pct / 100.0)
    max_soc_kwh = req.usable_capacity_kwh * (req.max_soc_pct / 100.0)
    max_energy_step_kwh = req.power_rating_kw * 0.25 # 15 minutes
    
    blocks: List[BESSDispatchBlock] = []
    total_cost = 0.0
    total_rev = 0.0
    throughput_kwh = 0.0
    
    for b in range(1, 97):
        price_mwh = req.prices_inr_per_mwh[b - 1]
        price_kwh = price_mwh / 1000.0
        
        action = "IDLE"
        power_kw = 0.0
        cost_step = 0.0
        rev_step = 0.0
        
        # Charge condition: price is low and SOC headroom exists
        if price_mwh <= p_low and current_soc_kwh < max_soc_kwh:
            headroom = max_soc_kwh - current_soc_kwh
            energy_to_charge = min(max_energy_step_kwh, headroom)
            power_kw = round(energy_to_charge / 0.25, 2)
            energy_stored = energy_to_charge * req.charge_efficiency
            current_soc_kwh += energy_stored
            cost_step = round(energy_to_charge * price_kwh, 2)
            total_cost += cost_step
            throughput_kwh += energy_to_charge
            action = "CHARGE"
            
        # Discharge condition: price is high and energy available above min SOC
        elif price_mwh >= p_high and current_soc_kwh > min_soc_kwh:
            available = current_soc_kwh - min_soc_kwh
            energy_to_extract = min(max_energy_step_kwh, available)
            power_kw = round(energy_to_extract / 0.25, 2)
            energy_delivered = energy_to_extract * req.discharge_efficiency
            current_soc_kwh -= energy_to_extract
            rev_step = round(energy_delivered * price_kwh, 2)
            total_rev += rev_step
            throughput_kwh += energy_to_extract
            action = "DISCHARGE"
            
        soc_pct = round((current_soc_kwh / req.usable_capacity_kwh) * 100.0, 1)
        blocks.append(BESSDispatchBlock(
            block_index=b,
            recommended_action=action,
            power_kw=power_kw,
            resulting_soc_pct=soc_pct,
            marginal_cost_inr=cost_step,
            marginal_revenue_inr=rev_step
        ))
        
    cycles = round(throughput_kwh / (2.0 * req.usable_capacity_kwh), 2)
    deg_cost = round(cycles * req.degradation_cost_per_cycle_inr, 2)
    gross_val = round(total_rev - total_cost, 2)
    net_val = round(gross_val - deg_cost, 2)
    
    return BESSSolverResponse(
        battery_id=req.battery_id,
        site_id=req.site_id,
        is_feasibility_verified=True,
        gross_arbitrage_value_inr=gross_val,
        estimated_degradation_cost_inr=deg_cost,
        net_opportunity_value_inr=net_val,
        cycles_equivalent=cycles,
        blocks=blocks
    )


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
