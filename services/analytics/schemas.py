"""
Pydantic Schemas for Aetheon Analytics Microservice
Defines strongly-typed request and response contracts for 96-block numerical processing.
"""

from typing import Dict, List, Literal, Optional
from pydantic import BaseModel, Field, model_validator, ConfigDict, field_validator
from datetime import date


class BlockData(BaseModel):
    block_index: int = Field(..., ge=1, le=96, description="Block index from 1 to 96")
    start_time: str = Field(..., description="HH:MM start time")
    end_time: str = Field(..., description="HH:MM end time")
    value: float = Field(..., description="Numerical value for the block")


class DatedNumericalRequest(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    is_demo: bool = False

    @field_validator("operating_date", check_fields=False)
    @classmethod
    def calendar_date(cls, value):
        date.fromisoformat(value)
        return value


class GridForecastRequest(DatedNumericalRequest):
    site_id: str = Field(..., min_length=1)
    operating_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$", description="YYYY-MM-DD")
    contract_demand_kw: float = Field(..., gt=0)
    historical_days: List["GridHistoricalDay"] = Field(default_factory=list)
    evaluation_date: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    latest_input_complete: bool = True
    historical_replay: bool = False
    historical_load_kw: Optional[List[float]] = None
    seed: Optional[int] = 42

    @field_validator("evaluation_date")
    @classmethod
    def valid_evaluation_date(cls, value):
        if value is not None:
            date.fromisoformat(value)
        return value

    @model_validator(mode="after")
    def unique_history_dates(self):
        dates = [day.operating_date for day in self.historical_days]
        if len(dates) != len(set(dates)):
            raise ValueError("historical_days must contain unique operating dates")
        return self


class GridHistoricalDay(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    operating_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    load_kw: List[float] = Field(..., min_length=96, max_length=96)

    @field_validator("operating_date")
    @classmethod
    def valid_operating_date(cls, value):
        date.fromisoformat(value)
        return value

    @field_validator("load_kw")
    @classmethod
    def nonnegative_load(cls, values):
        if any(value < 0 for value in values):
            raise ValueError("load_kw cannot contain negative values")
        return values


class GridForecastBlock(BaseModel):
    block_index: int = Field(..., ge=1, le=96)
    start_time: str
    end_time: str
    forecast_load_kw: float
    forecast_price_inr_per_mwh: Optional[float] = None
    confidence_lower_kw: Optional[float] = None
    confidence_upper_kw: Optional[float] = None
    lower_bound_kw: Optional[float] = None
    upper_bound_kw: Optional[float] = None
    is_high_cost_window: Optional[bool] = None


class GridValidationMetrics(BaseModel):
    mae_kw: float
    rmse_kw: float
    smape_pct: float
    observations: int
    normalized_mae: Optional[float] = None
    peak_magnitude_error_kw: Optional[float] = None
    peak_timing_error_minutes: Optional[float] = None
    daily_mae_mean_kw: Optional[float] = None
    daily_mae_median_kw: Optional[float] = None


class GridForecastProvenance(BaseModel):
    input_source: Literal["COMMITTED_INTERVAL_DATA_96"]
    model_family: Literal["DAY_AHEAD_DEMAND"]
    validation_method: Literal["CHRONOLOGICAL_HOLDOUT", "WALK_FORWARD"]
    price_source: None = None


class GridForecastResponse(BaseModel):
    site_id: str
    operating_date: str
    model_status: Literal["VALIDATED", "CALIBRATING", "FAILED_VALIDATION", "STALE_INPUT"]
    validation_status: Literal["VALIDATED", "CALIBRATING", "FAILED_VALIDATION"]
    forecast_available: bool = False
    forecast_status: Literal["AVAILABLE", "SUPPRESSED"]
    model_version: str
    model_generation_time: str
    training_start_date: Optional[str] = None
    training_end_date: Optional[str] = None
    latest_input_date: Optional[str] = None
    forecast_target_date: Optional[str] = None
    freshness_days: Optional[int] = None
    selected_model: Optional[str] = None
    validation_metrics: Optional[GridValidationMetrics] = None
    baseline_metrics: Dict[str, GridValidationMetrics] = Field(default_factory=dict)
    runner_up: Optional[str] = None
    baseline_model: Optional[str] = None
    model_comparison_metrics: Dict[str, GridValidationMetrics] = Field(default_factory=dict)
    improvement_vs_baseline_percent: Optional[float] = None
    validation_days: int = 0
    ensemble_weights: Dict[str, float] = Field(default_factory=dict)
    empirical_interval_status: Literal["AVAILABLE", "INSUFFICIENT_EVIDENCE"] = "INSUFFICIENT_EVIDENCE"
    drift_status: Literal["NORMAL", "DRIFT_WARNING", "INSUFFICIENT_EVIDENCE"] = "INSUFFICIENT_EVIDENCE"
    provenance: GridForecastProvenance
    average_price_inr_per_mwh: Optional[float] = None
    peak_demand_kw: Optional[float] = None
    peak_demand_block: Optional[int] = None
    blocks: List[GridForecastBlock]
    is_suppressed: bool = False
    suppression_reason: Optional[str] = None
    confidence_status: str = "UNAVAILABLE"
    data_quality: str = "UNVERIFIED"
    freshness: str = "UNKNOWN"
    price_status: str = "AUTHORITATIVE_PRICE_FEED_REQUIRED"


class DSMDeviationBlock(BaseModel):
    block_index: int = Field(..., ge=1, le=96)
    scheduled_drawal_kw: float
    actual_drawal_kw: float
    deviation_kw: float
    deviation_pct: Optional[float] = None
    risk_level: str  # NORMAL, WATCH, HIGH, CRITICAL
    estimated_penalty_inr: Optional[float] = None


class DSMCalculationRequest(DatedNumericalRequest):
    site_id: str = Field(..., min_length=1)
    operating_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    scheduled_drawal_kw: List[float] = Field(..., min_length=96, max_length=96)
    actual_drawal_kw: List[float] = Field(..., min_length=96, max_length=96)
    contract_demand_kw: float = Field(..., gt=0)

    @field_validator("scheduled_drawal_kw", "actual_drawal_kw")
    @classmethod
    def nonnegative_drawal(cls, values):
        if any(v < 0 for v in values):
            raise ValueError("Negative drawal requires a separately validated export model")
        return values


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
    estimated_total_exposure_inr: Optional[float] = None
    model_version: str = "DSM_TECHNICAL_DEVIATION_v2.0"
    risk_basis: str = "TECHNICAL_HEURISTIC_NOT_REGULATORY"
    monetary_exposure_status: str = "REGULATORY_CONFIGURATION_REQUIRED"
    blocks: List[DSMDeviationBlock]
    status: str = "COMPLETED"


class BESSSolverRequest(DatedNumericalRequest):
    battery_id: str = Field(..., min_length=1)
    site_id: str = Field(..., min_length=1)
    operating_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    usable_capacity_kwh: float = Field(..., gt=0)
    power_rating_kw: float = Field(..., gt=0)
    initial_soc_pct: float = Field(..., ge=0, le=100)
    min_soc_pct: float = Field(..., ge=0, le=100)
    max_soc_pct: float = Field(..., ge=0, le=100)
    charge_efficiency: float = Field(default=0.92, gt=0, le=1.0)
    discharge_efficiency: float = Field(default=0.92, gt=0, le=1.0)
    degradation_cost_per_cycle_inr: float = Field(default=1500.0, ge=0)
    prices_inr_per_mwh: List[float] = Field(..., min_length=96, max_length=96)

    maintenance_lock_active: bool = False
    telemetry_stale: bool = False
    interconnection_restricted: bool = False

    @model_validator(mode="after")
    def validate_soc_bounds(self) -> "BESSSolverRequest":
        if self.min_soc_pct >= self.max_soc_pct:
            raise ValueError("min_soc_pct must be strictly less than max_soc_pct")
        if not (self.min_soc_pct <= self.initial_soc_pct <= self.max_soc_pct):
            raise ValueError("initial_soc_pct must be within [min_soc_pct, max_soc_pct]")
        return self


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
    operating_date: str
    is_suppressed: bool = False
    suppression_reason: Optional[str] = None
    power_basis: str = "AC_GRID_KW"
    terminal_soc_policy: str = "RETURN_TO_INITIAL_SOC"
    is_feasibility_verified: bool
    gross_arbitrage_value_inr: float
    estimated_degradation_cost_inr: float
    net_opportunity_value_inr: float
    cycles_equivalent: float
    blocks: List[BESSDispatchBlock]
    safety_disclaimer: str = (
        "Advisory recommendation only. This output does not control physical BMS/SCADA equipment."
    )


class BESSBehindMeterRequest(DatedNumericalRequest):
    profile_id: str = Field(..., min_length=1)
    site_id: str = Field(..., min_length=1)
    operating_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    nameplate_energy_capacity_kwh: float = Field(..., gt=0)
    max_charge_power_kw: float = Field(..., gt=0)
    max_discharge_power_kw: float = Field(..., gt=0)
    minimum_soc_percent: float = Field(..., ge=0, le=100)
    maximum_soc_percent: float = Field(..., ge=0, le=100)
    initial_soc_percent: float = Field(..., ge=0, le=100)
    final_soc_requirement: Literal["RETURN_TO_INITIAL_SOC", "MINIMUM_FINAL_SOC"]
    final_soc_percent: Optional[float] = Field(None, ge=0, le=100)
    charge_efficiency_percent: float = Field(..., gt=0, le=100)
    discharge_efficiency_percent: float = Field(..., gt=0, le=100)
    maximum_daily_throughput_kwh: float = Field(..., gt=0)
    degradation_cost_rs_per_kwh_throughput: float = Field(..., ge=0)
    available_blocks: Optional[List[int]] = None
    forecast_load_kw: List[float] = Field(..., min_length=96, max_length=96)
    forecast_lower_kw: Optional[List[float]] = Field(None, min_length=96, max_length=96)
    forecast_upper_kw: Optional[List[float]] = Field(None, min_length=96, max_length=96)
    prices_inr_per_mwh: List[float] = Field(..., min_length=96, max_length=96)
    price_source_reference: str = Field(..., min_length=1)
    price_source_file_hash: str = Field(..., min_length=1)
    price_provenance_status: Literal["OFFICIAL_SOURCE_CONFIRMED"]
    price_verification_status: Literal["VERIFIED"]
    forecast_model_version: str = Field(..., min_length=1)
    forecast_selected_model: str = Field(..., min_length=1)
    forecast_drift_status: str = Field(..., min_length=1)

    @model_validator(mode="after")
    def validate_profile_and_arrays(self) -> "BESSBehindMeterRequest":
        if self.minimum_soc_percent >= self.maximum_soc_percent:
            raise ValueError("minimum_soc_percent must be strictly less than maximum_soc_percent")
        if not self.minimum_soc_percent <= self.initial_soc_percent <= self.maximum_soc_percent:
            raise ValueError("initial_soc_percent must be within SOC bounds")
        if self.final_soc_requirement == "MINIMUM_FINAL_SOC" and self.final_soc_percent is None:
            raise ValueError("final_soc_percent is required for MINIMUM_FINAL_SOC")
        if self.final_soc_percent is not None and not self.minimum_soc_percent <= self.final_soc_percent <= self.maximum_soc_percent:
            raise ValueError("final_soc_percent must be within SOC bounds")
        if self.available_blocks is not None and (len(set(self.available_blocks)) != len(self.available_blocks) or
                                                   any(block < 1 or block > 96 for block in self.available_blocks)):
            raise ValueError("available_blocks must contain unique block indexes from 1 to 96")
        if any(value < 0 for values in [self.forecast_load_kw, self.forecast_lower_kw or [], self.forecast_upper_kw or []]
               for value in values):
            raise ValueError("forecast load values must be non-negative")
        return self


class BESSBehindMeterResponse(BaseModel):
    profile_id: str
    site_id: str
    operating_date: str
    solver_version: str = "BESS_BEHIND_METER_SCIPY_MILP_v1.0"
    simulation_label: str = "BEHIND-THE-METER BESS ENERGY-SHIFT SIMULATION"
    status: str
    suppression_reason: Optional[str] = None
    feasibility_verified: bool
    uncertainty_status: str
    drift_status: str
    baseline_load_kw: List[float]
    optimized_grid_import_kw: List[float]
    charge_kw: List[float]
    discharge_kw: List[float]
    soc_kwh: List[float]
    soc_pct: List[float]
    mcp_inr_per_mwh: List[float]
    baseline_iex_component_inr: float
    battery_iex_component_inr: float
    gross_iex_component_reduction_inr: float
    degradation_cost_inr: float
    net_indicative_benefit_inr: float
    throughput_kwh: float
    equivalent_full_cycles: float
    minimum_soc_pct_observed: float
    maximum_soc_pct_observed: float
    final_soc_pct: float
    charge_blocks: List[int]
    discharge_blocks: List[int]
    scenario_net_benefit_inr: Dict[str, float]
    profile: Dict[str, object]
    provenance: Dict[str, object]
    safety_disclaimer: str = "Advisory simulation only. No BMS, inverter, SCADA, bid, trade, or physical dispatch instruction is issued."


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
