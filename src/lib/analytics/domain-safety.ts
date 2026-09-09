import crypto from 'node:crypto';

export const LIVE_GRID_BLOCK = 'LIVE_MODEL_AND_PRICE_FEED_REQUIRED: The installed GRID model uses synthetic demand, market prices and uncalibrated confidence bands.';
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
