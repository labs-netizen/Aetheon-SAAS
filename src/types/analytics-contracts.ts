/**
 * Canonical TypeScript Contracts matching FastAPI Pydantic Schemas (services/analytics/schemas.py)
 */

export interface GridForecastBlockContract {
  block_index: number;
  start_time: string;
  end_time: string;
  forecast_load_kw: number;
  forecast_price_inr_per_mwh: number | null;
  confidence_lower_kw: number;
  confidence_upper_kw: number;
  is_high_cost_window: boolean | null;
}

export interface GridValidationMetricsContract {
  mae_kw: number;
  rmse_kw: number;
  smape_pct: number;
  observations: number;
}

export interface GridForecastResponseContract {
  site_id: string;
  operating_date: string;
  model_status: 'VALIDATED' | 'CALIBRATING' | 'FAILED_VALIDATION' | 'STALE_INPUT';
  validation_status: 'VALIDATED' | 'CALIBRATING' | 'FAILED_VALIDATION';
  forecast_available: boolean;
  forecast_status: 'AVAILABLE' | 'SUPPRESSED';
  model_version: 'GRID_HISTORICAL_LOAD_V1.0';
  model_generation_time: string;
  training_start_date: string | null;
  training_end_date: string | null;
  latest_input_date: string | null;
  forecast_target_date: string | null;
  freshness_days: number | null;
  selected_model: string | null;
  validation_metrics: GridValidationMetricsContract | null;
  baseline_metrics: Record<string, GridValidationMetricsContract>;
  provenance: {
    input_source: 'COMMITTED_INTERVAL_DATA_96';
    model_family: 'DAY_AHEAD_DEMAND';
    validation_method: 'CHRONOLOGICAL_HOLDOUT';
    price_source: null;
  };
  average_price_inr_per_mwh: null;
  peak_demand_kw: number | null;
  peak_demand_block: number | null;
  blocks: GridForecastBlockContract[];
  is_suppressed: boolean;
  suppression_reason: string | null;
  confidence_status: string;
  data_quality: 'PASSED' | 'UNVERIFIED';
  freshness: 'RECENT' | 'STALE' | 'UNKNOWN';
  price_status: 'AUTHORITATIVE_PRICE_FEED_REQUIRED';
  run_id?: string;
  persisted?: boolean;
}

export interface BESSDispatchBlockContract {
  block_index: number;
  recommended_action: 'CHARGE' | 'DISCHARGE' | 'IDLE';
  power_kw: number;
  resulting_soc_pct: number;
  marginal_cost_inr: number;
  marginal_revenue_inr: number;
}

export interface BESSSolverResponseContract {
  battery_id: string;
  site_id: string;
  solver_version: string;
  is_feasibility_verified: boolean;
  gross_arbitrage_value_inr: number;
  estimated_degradation_cost_inr: number;
  net_opportunity_value_inr: number;
  cycles_equivalent: number;
  blocks: BESSDispatchBlockContract[];
  safety_disclaimer: string;
  persisted?: boolean;
  is_suppressed?: boolean;
  suppression_reason?: string | null;
}

export interface DSMDeviationBlockContract {
  block_index: number;
  scheduled_drawal_kw: number;
  actual_drawal_kw: number;
  deviation_kw: number;
  deviation_pct: number;
  risk_level: 'NORMAL' | 'WATCH' | 'HIGH' | 'CRITICAL';
  estimated_penalty_inr: number;
}

export interface DSMIncidentContract {
  start_block: number;
  end_block: number;
  severity: 'WATCH' | 'HIGH' | 'CRITICAL';
  max_deviation_pct: number;
  total_excess_energy_kwh: number;
  estimated_exposure_inr: number;
  root_cause_tag: string;
}

export interface DSMCalculationResponseContract {
  site_id: string;
  operating_date: string;
  rule_version: string;
  total_deviation_kwh: number;
  max_positive_deviation_kw: number;
  max_negative_deviation_kw: number;
  blocks_in_watch: number;
  blocks_in_high: number;
  blocks_in_critical: number;
  estimated_total_exposure_inr: number;
  blocks: DSMDeviationBlockContract[];
  incidents: DSMIncidentContract[];
  status: string;
  persisted?: boolean;
  is_suppressed?: boolean;
  suppression_reason?: string | null;
}

export interface RenewableReconciliationResponseContract {
  site_id: string;
  operating_date: string;
  total_measured_generation_kwh: number;
  total_modelled_generation_kwh: number;
  performance_ratio_pct: number;
  avoided_emissions_tco2e: number;
  emission_factor_source: string;
  reconciliation_status: string;
  classification?: {
    generation: 'MEASURED';
    modelled_expected: 'MODELLED';
    avoided_emissions: 'ESTIMATED';
    tariff_version: string;
    emission_factor_version: string;
  };
  persisted?: boolean;
}
