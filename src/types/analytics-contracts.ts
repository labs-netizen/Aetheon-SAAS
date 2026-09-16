/**
 * Canonical TypeScript Contracts matching FastAPI Pydantic Schemas (services/analytics/schemas.py)
 */

export interface GridForecastBlockContract {
  block_index: number;
  start_time: string;
  end_time: string;
  forecast_load_kw: number;
  forecast_price_inr_per_mwh: number | null;
  confidence_lower_kw: number | null;
  confidence_upper_kw: number | null;
  lower_bound_kw?: number | null;
  upper_bound_kw?: number | null;
  is_high_cost_window: boolean | null;
}

export interface GridValidationMetricsContract {
  mae_kw: number;
  rmse_kw: number;
  smape_pct: number;
  observations: number;
  normalized_mae?: number | null;
  peak_magnitude_error_kw?: number | null;
  peak_timing_error_minutes?: number | null;
  daily_mae_mean_kw?: number | null;
  daily_mae_median_kw?: number | null;
}

export interface GridForecastResponseContract {
  site_id: string;
  operating_date: string;
  model_status: 'VALIDATED' | 'CALIBRATING' | 'FAILED_VALIDATION' | 'STALE_INPUT';
  validation_status: 'VALIDATED' | 'CALIBRATING' | 'FAILED_VALIDATION';
  forecast_available: boolean;
  forecast_status: 'AVAILABLE' | 'SUPPRESSED';
  model_version: 'GRID_HISTORICAL_LOAD_V1.0' | 'GRID_HISTORICAL_LOAD_V2.0';
  model_generation_time: string;
  training_start_date: string | null;
  training_end_date: string | null;
  latest_input_date: string | null;
  forecast_target_date: string | null;
  freshness_days: number | null;
  selected_model: string | null;
  validation_metrics: GridValidationMetricsContract | null;
  baseline_metrics: Record<string, GridValidationMetricsContract>;
  runner_up?: string | null;
  baseline_model?: string | null;
  model_comparison_metrics?: Record<string, GridValidationMetricsContract>;
  improvement_vs_baseline_percent?: number | null;
  validation_days?: number;
  ensemble_weights?: Record<string, number>;
  empirical_interval_status?: 'AVAILABLE' | 'INSUFFICIENT_EVIDENCE';
  drift_status?: 'NORMAL' | 'DRIFT_WARNING' | 'INSUFFICIENT_EVIDENCE';
  provenance: {
    input_source: 'COMMITTED_INTERVAL_DATA_96';
    model_family: 'DAY_AHEAD_DEMAND';
    validation_method: 'CHRONOLOGICAL_HOLDOUT' | 'WALK_FORWARD';
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

export interface BESSBehindMeterResponseContract {
  profile_id: string;
  site_id: string;
  operating_date: string;
  solver_version: 'BESS_BEHIND_METER_SCIPY_MILP_v1.0';
  simulation_label: 'BEHIND-THE-METER BESS ENERGY-SHIFT SIMULATION';
  status: 'DISPATCH_IDENTIFIED' | 'NO_ECONOMIC_BESS_DISPATCH_IDENTIFIED' | 'SUPPRESSED';
  suppression_reason: string | null;
  feasibility_verified: boolean;
  uncertainty_status: 'ROBUST' | 'SENSITIVE_TO_FORECAST_UNCERTAINTY' | 'INSUFFICIENT_FORECAST_INTERVAL_EVIDENCE';
  drift_status: string;
  baseline_load_kw: number[];
  optimized_grid_import_kw: number[];
  charge_kw: number[];
  discharge_kw: number[];
  soc_kwh: number[];
  soc_pct: number[];
  mcp_inr_per_mwh: number[];
  baseline_iex_component_inr: number;
  battery_iex_component_inr: number;
  gross_iex_component_reduction_inr: number;
  degradation_cost_inr: number;
  net_indicative_benefit_inr: number;
  throughput_kwh: number;
  equivalent_full_cycles: number;
  minimum_soc_pct_observed: number;
  maximum_soc_pct_observed: number;
  final_soc_pct: number;
  charge_blocks: number[];
  discharge_blocks: number[];
  scenario_net_benefit_inr: Record<string, number>;
  profile: Record<string, unknown>;
  provenance: Record<string, unknown>;
  safety_disclaimer: string;
}

export interface BESSSizingCandidateContract {
  capacity_kwh: number; power_kw: number; duration_hours: number;
  energy_charged_kwh: number; energy_discharged_kwh: number;
  throughput_kwh: number; maximum_throughput_kwh: number; equivalent_full_cycles: number;
  minimum_soc_percent: number; maximum_soc_percent: number; final_soc_percent: number;
  charge_power_utilization_percent: number; discharge_power_utilization_percent: number;
  throughput_utilization_percent: number; usable_energy_utilization_percent: number;
  baseline_iex_component_inr: number; battery_iex_component_inr: number;
  gross_iex_component_reduction_inr: number; degradation_cost_inr: number;
  net_indicative_benefit_inr: number; net_benefit_per_kwh_capacity: number; net_benefit_per_kw_power: number;
  no_action: boolean; uncertainty_status: string; drift_status: string;
  pareto_status: 'PARETO_EFFICIENT' | 'DOMINATED'; solve_runtime_ms: number;
  dispatch: BESSBehindMeterResponseContract;
}

export interface BESSSizingResponseContract {
  site_id: string; operating_date: string;
  analysis_label: 'HISTORICAL BESS SIZING SCREEN'; analyzed_days: 1;
  evidence_warning: 'SINGLE-DAY HISTORICAL SIZING SCREEN — NOT SUFFICIENT FOR INVESTMENT SIZING';
  base_profile_id: string; base_max_efc_per_day: number; candidate_count: number;
  candidates: BESSSizingCandidateContract[];
  marginal_values: Array<{ dimension: 'CAPACITY' | 'POWER'; fixed_value: number; from_value: number;
    to_value: number; incremental_net_benefit_inr: number; incremental_benefit_per_unit_inr: number }>;
  best_candidate: { capacity_kwh: number; power_kw: number; net_indicative_benefit_inr: number };
  best_per_kwh_candidate: { capacity_kwh: number; power_kw: number; net_indicative_benefit_inr: number };
  best_per_kw_candidate: { capacity_kwh: number; power_kw: number; net_indicative_benefit_inr: number };
  compact_value_candidate: { capacity_kwh: number; power_kw: number; net_indicative_benefit_inr: number } | null;
  pareto_efficient_count: number; dominated_count: number; uncertainty_result: string;
  total_runtime_ms: number; median_candidate_runtime_ms: number;
  component_label: 'INDICATIVE IEX DAM ENERGY COMPONENT'; safety_disclaimer: string;
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
