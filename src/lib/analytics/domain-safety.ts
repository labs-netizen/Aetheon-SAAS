import crypto from 'node:crypto';

export const LIVE_GRID_BLOCK = 'LIVE_MODEL_AND_PRICE_FEED_REQUIRED: The installed GRID model uses synthetic demand, market prices and uncalibrated confidence bands.';
export const AUTHORITATIVE_PRICE_FEED_REQUIRED = 'AUTHORITATIVE_PRICE_FEED_REQUIRED';
export const LIVE_BESS_BLOCK = 'LIVE_PRICE_AND_INTERCONNECTION_AUTHORITY_REQUIRED: No verified live market-price feed or interconnection-limit evidence is configured.';
export const DSM_MODEL = 'DSM_TECHNICAL_DEVIATION_v2.0';

export function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value;
}
export function operatingToday(now = Date.now()) {
  return new Date(now + 330 * 60000).toISOString().slice(0,10);
}
export function finiteNumber(v: unknown): boolean {
  return (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v));
}
export function blocks96(rows: any[]): boolean {
  return Array.isArray(rows) && rows.length === 96 && rows.every((r,i) => r.block_index === i+1);
}
export function validGridDemo(r: any, siteId: string, date: string): boolean {
  const hhmm = (n: number) => `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
  return r?.site_id === siteId && r.operating_date === date && r.model_version === 'DEMO_BASELINE_v1.0' &&
    r.data_quality === 'DEMO_UNVERIFIED' && !r.is_suppressed && blocks96(r.blocks) &&
    ['average_price_inr_per_mwh','peak_demand_kw','peak_demand_block'].every(k => finiteNumber(r[k])) &&
    r.blocks.every((b: any,i: number) => b.start_time === hhmm(i*15) && b.end_time === hhmm((i+1)*15) &&
      ['forecast_demand_kw','forecast_price_inr_per_mwh','confidence_lower_kw','confidence_upper_kw'].every(k => finiteNumber(b[k])) &&
      Number(b.confidence_lower_kw) >= 0 && Number(b.confidence_lower_kw) <= Number(b.forecast_demand_kw) && Number(b.forecast_demand_kw) <= Number(b.confidence_upper_kw));
}
function validGridMetrics(value: any): boolean {
  return value !== null && typeof value === 'object' &&
    ['mae_kw','rmse_kw','smape_pct','observations'].every(key => finiteNumber(value[key])) &&
    Number(value.mae_kw) >= 0 && Number(value.rmse_kw) >= 0 && Number(value.smape_pct) >= 0 &&
    Number.isInteger(Number(value.observations)) && Number(value.observations) > 0;
}
function validGridProvenance(value: any, modelVersion: string): boolean {
  return value?.input_source === 'COMMITTED_INTERVAL_DATA_96' &&
    value.model_family === 'DAY_AHEAD_DEMAND' &&
    value.validation_method === (modelVersion === 'GRID_HISTORICAL_LOAD_V2.0' ? 'WALK_FORWARD' : 'CHRONOLOGICAL_HOLDOUT') &&
    value.price_source === null;
}
export function validGridAnalyticsResponse(r: any, siteId: string, date: string, mode: 'LIVE' | 'HISTORICAL_REPLAY' = 'LIVE'): boolean {
  const hhmm = (n: number) => n === 1440 ? '24:00' : `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
  const v2 = r?.model_version === 'GRID_HISTORICAL_LOAD_V2.0';
  if (r?.site_id !== siteId || r.operating_date !== date ||
      !['GRID_HISTORICAL_LOAD_V1.0','GRID_HISTORICAL_LOAD_V2.0'].includes(r.model_version) ||
      !validDate(r.operating_date) || typeof r.model_generation_time !== 'string' || !Number.isFinite(Date.parse(r.model_generation_time)) ||
      ![r.training_start_date,r.training_end_date,r.latest_input_date,r.forecast_target_date]
        .every(value => value === null || validDate(value)) ||
      !(r.freshness_days === null || Number.isInteger(r.freshness_days)) ||
      !(r.selected_model === null || typeof r.selected_model === 'string') ||
      !(r.validation_metrics === null || validGridMetrics(r.validation_metrics)) ||
      r.baseline_metrics === null || typeof r.baseline_metrics !== 'object' || Array.isArray(r.baseline_metrics) ||
      !Object.values(r.baseline_metrics).every(validGridMetrics) || !validGridProvenance(r.provenance, r.model_version) ||
      r.average_price_inr_per_mwh !== null || r.price_status !== AUTHORITATIVE_PRICE_FEED_REQUIRED ||
      !Array.isArray(r.blocks) || typeof r.forecast_available !== 'boolean' || typeof r.is_suppressed !== 'boolean' ||
      typeof r.confidence_status !== 'string' || !['PASSED','UNVERIFIED'].includes(r.data_quality) ||
      !['RECENT','STALE','UNKNOWN'].includes(r.freshness)) return false;

  if (v2) {
    const score = (value: any) => validGridMetrics(value) &&
      ['normalized_mae','peak_magnitude_error_kw','peak_timing_error_minutes','daily_mae_mean_kw','daily_mae_median_kw']
        .every(key => value[key] === null || (finiteNumber(value[key]) && Number(value[key]) >= 0));
    if (!Number.isInteger(r.validation_days) || r.validation_days < 0 || r.validation_days > 28 ||
        r.model_comparison_metrics === null || typeof r.model_comparison_metrics !== 'object' || Array.isArray(r.model_comparison_metrics) ||
        !Object.values(r.model_comparison_metrics).every(score) ||
        r.ensemble_weights === null || typeof r.ensemble_weights !== 'object' || Array.isArray(r.ensemble_weights) ||
        !['AVAILABLE','INSUFFICIENT_EVIDENCE'].includes(r.empirical_interval_status) ||
        !['NORMAL','DRIFT_WARNING','INSUFFICIENT_EVIDENCE'].includes(r.drift_status) ||
        !(r.runner_up === null || typeof r.runner_up === 'string') ||
        !(r.baseline_model === null || typeof r.baseline_model === 'string') ||
        !(r.improvement_vs_baseline_percent === null || finiteNumber(r.improvement_vs_baseline_percent)) ||
        (r.validation_metrics !== null && !score(r.validation_metrics)) ||
        (r.validation_days > 0 && (!r.selected_model || !r.baseline_model ||
          !r.model_comparison_metrics[r.selected_model] || !r.model_comparison_metrics[r.baseline_model] ||
          r.validation_metrics === null ||
          !['mae_kw','rmse_kw','smape_pct','observations'].every(key =>
            Number(r.validation_metrics[key]) === Number(r.model_comparison_metrics[r.selected_model][key])) ||
          !Object.values(r.model_comparison_metrics).every((metric: any) => Number(metric.observations) === r.validation_days * 96) ||
          Math.abs(Number(r.improvement_vs_baseline_percent) -
            100 * (Number(r.model_comparison_metrics[r.baseline_model].mae_kw) - Number(r.validation_metrics.mae_kw)) /
            Math.max(Number(r.model_comparison_metrics[r.baseline_model].mae_kw), 1e-9)) > 0.01 ||
          !score(r.baseline_metrics.PREVIOUS_DAY_SAME_BLOCK) || !score(r.baseline_metrics.PREVIOUS_WEEK_SAME_BLOCK))) ||
        (r.selected_model === 'VALIDATED_WEIGHTED_ENSEMBLE'
          ? (Object.keys(r.ensemble_weights).length < 2 ||
             !Object.entries(r.ensemble_weights).every(([name, weight]) =>
               Boolean(r.model_comparison_metrics[name]) && finiteNumber(weight) && Number(weight) >= 0 && Number(weight) <= 0.65) ||
             Math.abs(Object.values(r.ensemble_weights).reduce((sum: number, weight: any) => sum + Number(weight), 0) - 1) > 1e-6)
          : Object.keys(r.ensemble_weights).length !== 0)) return false;
  }

  if (r.forecast_available === false) {
    const validStatus = r.forecast_status === 'SUPPRESSED' && r.is_suppressed === true && r.blocks.length === 0 &&
      typeof r.suppression_reason === 'string' && r.suppression_reason.length > 0 &&
      ['CALIBRATING','FAILED_VALIDATION','STALE_INPUT'].includes(r.model_status) &&
      r.peak_demand_kw === null && r.peak_demand_block === null && r.data_quality === 'UNVERIFIED' &&
      ((r.model_status === 'CALIBRATING' && r.validation_status === 'CALIBRATING' && r.freshness === 'UNKNOWN') ||
       (r.model_status === 'FAILED_VALIDATION' && r.validation_status === 'FAILED_VALIDATION' && r.freshness === 'UNKNOWN') ||
       (r.model_status === 'STALE_INPUT' && r.validation_status === 'VALIDATED' && r.freshness === 'STALE' &&
        Number.isInteger(r.freshness_days) && r.freshness_days > 1 && validGridMetrics(r.validation_metrics)));
    return validStatus;
  }

  return r.forecast_status === 'AVAILABLE' && r.is_suppressed === false && r.suppression_reason === null &&
    r.forecast_target_date === date && r.model_status === 'VALIDATED' && r.validation_status === 'VALIDATED' &&
    r.data_quality === 'PASSED' && (mode === 'LIVE' ? r.freshness === 'RECENT' :
      r.latest_input_date !== null && r.freshness === (r.freshness_days > 1 ? 'STALE' : 'RECENT')) && finiteNumber(r.peak_demand_kw) &&
    Number.isInteger(r.peak_demand_block) && r.peak_demand_block >= 1 && r.peak_demand_block <= 96 &&
    validGridMetrics(r.validation_metrics) && typeof r.selected_model === 'string' && blocks96(r.blocks) &&
    r.blocks.every((b: any,i: number) =>
      b.start_time === hhmm(i*15) && b.end_time === hhmm((i+1)*15) &&
      finiteNumber(b.forecast_load_kw) &&
      b.forecast_price_inr_per_mwh === null && b.is_high_cost_window === null &&
      (v2
        ? (b.confidence_lower_kw === null && b.confidence_upper_kw === null &&
           (r.empirical_interval_status === 'INSUFFICIENT_EVIDENCE'
             ? b.lower_bound_kw === null && b.upper_bound_kw === null
             : finiteNumber(b.lower_bound_kw) && finiteNumber(b.upper_bound_kw) &&
               Number(b.lower_bound_kw) >= 0 && Number(b.lower_bound_kw) <= Number(b.forecast_load_kw) &&
               Number(b.forecast_load_kw) <= Number(b.upper_bound_kw)))
        : finiteNumber(b.confidence_lower_kw) && finiteNumber(b.confidence_upper_kw) &&
          Number(b.confidence_lower_kw) >= 0 && Number(b.confidence_lower_kw) <= Number(b.forecast_load_kw) &&
          Number(b.forecast_load_kw) <= Number(b.confidence_upper_kw)));
}
export function validIntervals(rows: any[], date: string, fields: string[], now = Date.now()): boolean {
  if (!validDate(date) || !blocks96(rows)) return false;
  const start = Date.parse(`${date}T00:00:00+05:30`);
  return rows.every((r,i) => r.operating_date === date && Date.parse(r.timestamp_utc) === start+i*900000 &&
    start+(i+1)*900000 <= now && fields.every(f => finiteNumber(r[f]) && Number(r[f]) >= 0));
}
export function dsmInputRows(rows: any[]) {
  return rows.map(r => ({ block_index: r.block_index, operating_date: r.operating_date,
    timestamp_utc: new Date(r.timestamp_utc).toISOString(), scheduled_drawal_kw: Number(r.scheduled_drawal_kw), actual_drawal_kw: Number(r.actual_drawal_kw) }));
}
export function inputHash(rows: any[]) {
  return crypto.createHash('sha256').update(JSON.stringify(dsmInputRows(rows))).digest('hex');
}
export function validDSM(result: any, siteId: string, date: string, scheduled: number[], actual: number[]): boolean {
  if (!result || result.site_id !== siteId || result.operating_date !== date || result.model_version !== DSM_MODEL ||
      result.status !== 'COMPLETED' || result.is_suppressed || !blocks96(result.blocks)) return false;
  let total = 0, maxPositive = 0, maxNegative = 0;
  const counts: Record<string,number> = { WATCH: 0, HIGH: 0, CRITICAL: 0 };
  const valid = result.blocks.every((b: any,i: number) => {
    const delta = actual[i]-scheduled[i];
    const pct = scheduled[i] > 0 ? delta/scheduled[i]*100 : actual[i] === 0 ? 0 : null;
    const riskPct = pct === null ? Infinity : Math.abs(pct);
    const risk = riskPct < 4 ? 'NORMAL' : riskPct < 8 ? 'WATCH' : riskPct < 12 ? 'HIGH' : 'CRITICAL';
    total += Math.abs(delta)*0.25;
    maxPositive = Math.max(maxPositive,delta); maxNegative = Math.min(maxNegative,delta);
    if (risk !== 'NORMAL') counts[risk]++;
    return b.scheduled_drawal_kw === scheduled[i] && b.actual_drawal_kw === actual[i] &&
      finiteNumber(b.deviation_kw) && Math.abs(b.deviation_kw-delta) <= 0.011 && b.risk_level === risk &&
      (pct === null ? b.deviation_pct === null : finiteNumber(b.deviation_pct) && Math.abs(b.deviation_pct-pct) <= 0.011);
  });
  return valid && finiteNumber(result.total_deviation_kwh) && Math.abs(result.total_deviation_kwh-total) <= 0.02 &&
    finiteNumber(result.max_positive_deviation_kw) && Math.abs(result.max_positive_deviation_kw-maxPositive)<=0.011 &&
    finiteNumber(result.max_negative_deviation_kw) && Math.abs(result.max_negative_deviation_kw-maxNegative)<=0.011 &&
    result.blocks_in_watch === counts.WATCH && result.blocks_in_high === counts.HIGH && result.blocks_in_critical === counts.CRITICAL;
}
export function validBessParameters(p: any): boolean {
  return ['usableCapacityKwh','powerRatingKw','initialSocPct','minSocPct','maxSocPct','chargeEfficiency','dischargeEfficiency','degradationCostPerCycleInr']
    .every(k => finiteNumber(p[k])) && p.usableCapacityKwh > 0 && p.powerRatingKw > 0 &&
    p.minSocPct >= 0 && p.maxSocPct <= 100 && p.minSocPct < p.maxSocPct &&
    p.initialSocPct >= p.minSocPct && p.initialSocPct <= p.maxSocPct &&
    p.chargeEfficiency > 0 && p.chargeEfficiency <= 1 && p.dischargeEfficiency > 0 && p.dischargeEfficiency <= 1 && p.degradationCostPerCycleInr >= 0;
}
export function validBessDispatch(result: any, p: any): boolean {
  if (!validBessParameters(p) || !result || result.battery_id !== p.batteryId || result.site_id !== p.siteId ||
      result.operating_date !== p.operatingDate || result.is_feasibility_verified !== true || result.is_suppressed ||
      result.solver_version !== (p.isDemo ? 'BESS_AC_HEURISTIC_DEMO_v2.0' : 'BESS_AC_HEURISTIC_v2.0') ||
      result.power_basis !== 'AC_GRID_KW' || result.terminal_soc_policy !== 'RETURN_TO_INITIAL_SOC' || !blocks96(result.blocks)) return false;
  let energy = p.usableCapacityKwh*p.initialSocPct/100, throughput = 0, cost = 0, revenue = 0;
  for (let i=0; i<96; i++) {
    const b = result.blocks[i], price = p.pricesInrPerMwh[i];
    if (!finiteNumber(price) || !finiteNumber(b.power_kw) || b.power_kw < 0 || b.power_kw > p.powerRatingKw+1e-7 ||
        !finiteNumber(b.resulting_soc_pct) || !finiteNumber(b.marginal_cost_inr) || !finiteNumber(b.marginal_revenue_inr)) return false;
    // The single action defines the AC power direction; contradictory dual-power fields are forbidden.
    if ((b.charge_power_kw ?? 0) !== 0 || (b.discharge_power_kw ?? 0) !== 0) return false;
    let stepCost = 0, stepRevenue = 0;
    if (b.recommended_action === 'CHARGE') {
      const stored = b.power_kw*0.25*p.chargeEfficiency; energy += stored; throughput += stored; stepCost = b.power_kw*0.25*price/1000;
    } else if (b.recommended_action === 'DISCHARGE') {
      const removed = b.power_kw*0.25/p.dischargeEfficiency; energy -= removed; throughput += removed; stepRevenue = b.power_kw*0.25*price/1000;
    } else if (b.recommended_action !== 'IDLE' || b.power_kw !== 0) return false;
    const soc = energy/p.usableCapacityKwh*100;
    if (soc < p.minSocPct-1e-6 || soc > p.maxSocPct+1e-6 || Math.abs(soc-b.resulting_soc_pct)>1e-5 ||
        Math.abs(stepCost-b.marginal_cost_inr)>0.011 || Math.abs(stepRevenue-b.marginal_revenue_inr)>0.011) return false;
    cost += stepCost; revenue += stepRevenue;
  }
  const cycles = throughput/(2*p.usableCapacityKwh), degradation = cycles*p.degradationCostPerCycleInr, gross = revenue-cost;
  return Math.abs(energy-p.usableCapacityKwh*p.initialSocPct/100)<1e-5 && gross-degradation > 0 &&
    [['cycles_equivalent',cycles],['gross_arbitrage_value_inr',gross],['estimated_degradation_cost_inr',degradation],['net_opportunity_value_inr',gross-degradation]]
      .every(([key,value]) => finiteNumber(result[key]) && Math.abs(Number(result[key])-Number(value)) <= 0.011);
}
