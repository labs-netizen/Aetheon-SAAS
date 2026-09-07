"""
Pydantic Schemas for Aetheon Analytics Microservice
Defines strongly-typed request and response contracts for 96-block numerical processing.
"""

from typing import List, Optional
from pydantic import BaseModel, Field


class BlockData(BaseModel):
    block_index: int = Field(..., ge=1, le=96, description="Block index from 1 to 96")
    start_time: str = Field(..., description="HH:MM start time")
    end_time: str = Field(..., description="HH:MM end time")
    value: float = Field(..., description="Numerical value for the block")


class GridForecastRequest(BaseModel):
    site_id: str
    operating_date: str = Field(..., description="YYYY-MM-DD")
    contract_demand_kw: float = Field(..., gt=0)
    historical_load_kw: Optional[List[float]] = None
    seed: Optional[int] = 42


class GridForecastBlock(BaseModel):
    block_index: int = Field(..., ge=1, le=96)
    start_time: str
    end_time: str
    forecast_demand_kw: float
    forecast_price_inr_per_mwh: float
    confidence_lower_kw: float
    confidence_upper_kw: float
    is_high_cost_window: bool


class GridForecastResponse(BaseModel):
    site_id: str
    operating_date: str
    model_version: str = "DEMO_BASELINE_v1.0"
    model_generation_time: str
    average_price_inr_per_mwh: float
    peak_demand_kw: float
    peak_demand_block: int
    blocks: List[GridForecastBlock]
    data_quality: str = "PASSED"
    freshness: str = "DEMO"


class DSMDeviationBlock(BaseModel):
    block_index: int = Field(..., ge=1, le=96)
    scheduled_drawal_kw: float
    actual_drawal_kw: float
    deviation_kw: float
    deviation_pct: float
    risk_level: str  # NORMAL, WATCH, HIGH, CRITICAL
    estimated_penalty_inr: float


class DSMCalculationRequest(BaseModel):
    site_id: str
    operating_date: str
    scheduled_drawal_kw: List[float] = Field(..., min_length=96, max_length=96)
    actual_drawal_kw: List[float] = Field(..., min_length=96, max_length=96)
    contract_demand_kw: float


class DSMCalculationResponse(BaseModel):
    site_id: str
    operating_date: str
    rule_version: str = "CERC_DSM_2024_DEMO"
    total_deviation_kwh: float
    max_positive_deviation_kw: float
    max_negative_deviation_kw: float
    blocks_in_watch: int
    blocks_in_high: int
    blocks_in_critical: int
    estimated_total_exposure_inr: float
    blocks: List[DSMDeviationBlock]
    status: str = "COMPLETED"


class BESSSolverRequest(BaseModel):
    battery_id: str
    site_id: str
    operating_date: str
    usable_capacity_kwh: float = Field(..., gt=0)
    power_rating_kw: float = Field(..., gt=0)
    initial_soc_pct: float = Field(..., ge=0, le=100)
    min_soc_pct: float = Field(..., ge=0, le=100)
    max_soc_pct: float = Field(..., ge=0, le=100)
    charge_efficiency: float = Field(default=0.92, gt=0, le=1.0)
    discharge_efficiency: float = Field(default=0.92, gt=0, le=1.0)
    degradation_cost_per_cycle_inr: float = Field(default=1500.0, ge=0)
    prices_inr_per_mwh: List[float] = Field(..., min_length=96, max_length=96)


class BESSDispatchBlock(BaseModel):
    block_index: int = Field(..., ge=1, le=96)
    recommended_action: str  # CHARGE, DISCHARGE, IDLE (Advisory opportunity window)
    power_kw: float
    resulting_soc_pct: float
    marginal_cost_inr: float
    marginal_revenue_inr: float


class BESSSolverResponse(BaseModel):
    battery_id: str
    site_id: str
    solver_version: str = "BESS_ADVISORY_HEURISTIC_DEMO_v1.0"
    is_feasibility_verified: bool
    gross_arbitrage_value_inr: float
    estimated_degradation_cost_inr: float
    net_opportunity_value_inr: float
    cycles_equivalent: float
    blocks: List[BESSDispatchBlock]
    safety_disclaimer: str = (
        "Advisory recommendation only. This output does not control physical BMS/SCADA equipment."
    )


class RenewableReconciliationRequest(BaseModel):
    site_id: str
    operating_date: str
    installed_capacity_kw: float
    measured_generation_kwh: List[float] = Field(..., min_length=96, max_length=96)
    grid_emission_factor_tco2e_per_mwh: float = Field(default=0.716)


class RenewableReconciliationResponse(BaseModel):
    site_id: str
    operating_date: str
    total_measured_generation_kwh: float
    total_modelled_generation_kwh: float
    performance_ratio_pct: float
    avoided_emissions_tco2e: float
    emission_factor_source: str = "CEA_CO2_BASELINE_DB_v19_DEMO"
    reconciliation_status: str = "RECONCILED"
