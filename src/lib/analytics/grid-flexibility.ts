import type { GridForecastResponseContract } from '@/types/analytics-contracts';
import type { SupabaseClient } from '@supabase/supabase-js';

export const FLEXIBILITY_OBJECTIVE = 'MINIMIZE_INDICATIVE_IEX_DAM_ENERGY_COMPONENT';
export const INDICATIVE_COMPONENT_LABEL = 'INDICATIVE IEX DAM ENERGY COMPONENT';

export interface SiteFlexibilityProfile {
  site_id: string;
  organisation_id: string;
  flexible_load_kw: number;
  maximum_shift_energy_kwh_per_day: number;
  maximum_upward_shift_kw_per_block: number;
  maximum_downward_shift_kw_per_block: number;
  earliest_shift_block: number;
  latest_shift_block: number;
  maximum_shift_duration_blocks: number;
  critical_blocks: number[];
  energy_conservation_required: boolean;
  minimum_operating_load_kw: number | null;
  maximum_operating_load_kw: number | null;
  is_active: boolean;
  updated_at?: string;
}

export interface FlexibilityDecision {
  status: 'READY' | 'SUPPRESSED';
  suppression_reason: string | null;
  mode: 'LIVE' | 'HISTORICAL_REPLAY';
  input_date: string;
  target_date: string;
  selected_forecast_model: string;
  forecast_validation_evidence: GridForecastResponseContract['validation_metrics'];
  drift_status: string;
  price_provenance: { import_id: string; source_reference: string; source_file_hash: string; delivery_date: string };
  flexibility_constraints: SiteFlexibilityProfile;
  optimization_objective: typeof FLEXIBILITY_OBJECTIVE;
  component_label: typeof INDICATIVE_COMPONENT_LABEL;
  baseline_profile_kw: number[];
  optimized_profile_kw: number[];
  delta_kw: number[];
  mcp_rs_per_mwh: number[];
  shifted_energy_kwh: number;
  baseline_indicative_component_inr: number;
  optimized_indicative_component_inr: number;
  indicative_difference_inr: number;
  indicative_difference_pct: number;
  modified_blocks: number;
  recommendations: Array<{ source_blocks: number[]; destination_blocks: number[]; load_delta_kw: number;
    energy_shifted_kwh: number; mcp_difference_rs_per_mwh: number; indicative_impact_inr: number;
    explanation: string }>;
  uncertainty_status: 'ROBUST' | 'SENSITIVE_TO_FORECAST_UNCERTAINTY' | 'INSUFFICIENT_INTERVAL_EVIDENCE';
  runtime_ms: number;
}

export interface GroupedFlexibilityAction {
  action: 'REDUCE' | 'INCREASE';
  start_block: number;
  end_block: number;
  time_window: string;
  peak_delta_kw: number;
  energy_kwh: number;
  average_mcp_rs_per_mwh: number;
  counterparty_average_mcp_rs_per_mwh: number | null;
  indicative_effect_inr: number;
}

export function blockTimeWindow(block: number) {
  if (!Number.isInteger(block) || block < 1 || block > 96) throw new Error('INVALID_GRID_BLOCK');
  const format = (minutes: number) => minutes === 1440 ? '24:00'
    : `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return `${format((block - 1) * 15)}–${format(block * 15)}`;
}

export function summarizeFlexibilityDecision(decision: FlexibilityDecision) {
  const tolerance = 1e-6;
  const sourceBlocks = decision.delta_kw.flatMap((value, index) => value < -tolerance ? [index + 1] : []);
  const destinationBlocks = decision.delta_kw.flatMap((value, index) => value > tolerance ? [index + 1] : []);
  const netEnergyKwh = decision.delta_kw.reduce((sum, value) => sum + value * 0.25, 0);
  const critical = new Set(decision.flexibility_constraints.critical_blocks);
  const criticalPass = decision.delta_kw.every((value, index) => !critical.has(index + 1) || Math.abs(value) <= tolerance);
  const min = decision.flexibility_constraints.minimum_operating_load_kw;
  const max = decision.flexibility_constraints.maximum_operating_load_kw;
  const boundsPass = decision.optimized_profile_kw.every((value) =>
    (min === null || value >= min - tolerance) && (max === null || value <= max + tolerance));
  return { flexibility_used_kwh: decision.shifted_energy_kwh,
    configured_maximum_kwh: decision.flexibility_constraints.maximum_shift_energy_kwh_per_day,
    source_blocks_modified: sourceBlocks.length, destination_blocks_modified: destinationBlocks.length,
    total_modified_blocks: sourceBlocks.length + destinationBlocks.length,
    energy_conservation_status: Math.abs(netEnergyKwh) <= tolerance ? 'PASS' as const : 'FAIL' as const,
    critical_block_status: criticalPass ? 'PASS' as const : 'FAIL' as const,
    operating_bound_status: boundsPass ? 'PASS' as const : 'FAIL' as const };
}

export function groupFlexibilityActions(decision: FlexibilityDecision): GroupedFlexibilityAction[] {
  const groups: Array<{ action: 'REDUCE' | 'INCREASE'; blocks: number[] }> = [];
  decision.delta_kw.forEach((value, index) => {
    if (Math.abs(value) <= 1e-7) return;
    const action = value < 0 ? 'REDUCE' : 'INCREASE';
    const block = index + 1;
    const previous = groups.at(-1);
    if (previous?.action === action && previous.blocks.at(-1) === block - 1) previous.blocks.push(block);
    else groups.push({ action, blocks: [block] });
  });
  const sourceBlocks = decision.delta_kw.flatMap((value, index) => value < -1e-7 ? [index + 1] : []);
  const destinationBlocks = decision.delta_kw.flatMap((value, index) => value > 1e-7 ? [index + 1] : []);
  const average = (blocks: number[]) => blocks.length
    ? blocks.reduce((sum, block) => sum + decision.mcp_rs_per_mwh[block - 1], 0) / blocks.length : null;
  return groups.map(({ action, blocks }) => {
    const start = blocks[0]; const end = blocks.at(-1)!;
    const energy = blocks.reduce((sum, block) => sum + Math.abs(decision.delta_kw[block - 1]) * 0.25, 0);
    const ownMcp = energy > 0 ? blocks.reduce((sum, block) => sum +
      decision.mcp_rs_per_mwh[block - 1] * Math.abs(decision.delta_kw[block - 1]) * 0.25, 0) / energy : average(blocks)!;
    const related = decision.recommendations.filter((recommendation) =>
      (action === 'REDUCE' ? recommendation.source_blocks : recommendation.destination_blocks)
        .some((block) => blocks.includes(block)));
    const relatedEnergy = related.reduce((sum, recommendation) => sum + recommendation.energy_shifted_kwh, 0);
    const counterpartyMcp = relatedEnergy > 0 ? related.reduce((sum, recommendation) => {
      const counterpart = action === 'REDUCE' ? recommendation.destination_blocks : recommendation.source_blocks;
      return sum + (average(counterpart) || 0) * recommendation.energy_shifted_kwh;
    }, 0) / relatedEnergy : average(action === 'REDUCE' ? destinationBlocks : sourceBlocks);
    return { action, start_block: start, end_block: end,
      time_window: `${blockTimeWindow(start).split('–')[0]}–${blockTimeWindow(end).split('–')[1]}`,
      peak_delta_kw: Math.max(...blocks.map((block) => Math.abs(decision.delta_kw[block - 1]))),
      energy_kwh: energy, average_mcp_rs_per_mwh: ownMcp,
      counterparty_average_mcp_rs_per_mwh: counterpartyMcp,
      indicative_effect_inr: related.length > 0
        ? related.reduce((sum, recommendation) => sum + recommendation.indicative_impact_inr, 0)
        : counterpartyMcp === null ? 0 : energy * Math.abs(ownMcp - counterpartyMcp) / 1000 };
  });
}

export function validateFlexibilityProfile(value: unknown): SiteFlexibilityProfile | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as SiteFlexibilityProfile;
  const positive = [p.flexible_load_kw, p.maximum_shift_energy_kwh_per_day,
    p.maximum_upward_shift_kw_per_block, p.maximum_downward_shift_kw_per_block];
  if (!positive.every((v) => Number.isFinite(Number(v)) && Number(v) > 0) ||
      !Number.isInteger(Number(p.earliest_shift_block)) || !Number.isInteger(Number(p.latest_shift_block)) ||
      p.earliest_shift_block < 1 || p.latest_shift_block > 96 || p.earliest_shift_block > p.latest_shift_block ||
      !Number.isInteger(Number(p.maximum_shift_duration_blocks)) || p.maximum_shift_duration_blocks < 1 ||
      p.maximum_shift_duration_blocks > 96 || !Array.isArray(p.critical_blocks) ||
      p.critical_blocks.some((b) => !Number.isInteger(Number(b)) || b < 1 || b > 96) ||
      typeof p.energy_conservation_required !== 'boolean' || p.is_active !== true) return null;
  const min = p.minimum_operating_load_kw;
  const max = p.maximum_operating_load_kw;
  if ((min !== null && (!Number.isFinite(Number(min)) || Number(min) < 0)) ||
      (max !== null && (!Number.isFinite(Number(max)) || Number(max) <= 0)) ||
      (min !== null && max !== null && Number(min) > Number(max))) return null;
  return { ...p, flexible_load_kw: Number(p.flexible_load_kw),
    maximum_shift_energy_kwh_per_day: Number(p.maximum_shift_energy_kwh_per_day),
    maximum_upward_shift_kw_per_block: Number(p.maximum_upward_shift_kw_per_block),
    maximum_downward_shift_kw_per_block: Number(p.maximum_downward_shift_kw_per_block),
    earliest_shift_block: Number(p.earliest_shift_block), latest_shift_block: Number(p.latest_shift_block),
    maximum_shift_duration_blocks: Number(p.maximum_shift_duration_blocks),
    minimum_operating_load_kw: min === null ? null : Number(min),
    maximum_operating_load_kw: max === null ? null : Number(max),
    critical_blocks: [...new Set(p.critical_blocks.map(Number))].sort((a, b) => a - b) };
}

function optimizeProfile(baseline: number[], prices: number[], profile: SiteFlexibilityProfile) {
  const delta = Array(96).fill(0) as number[];
  const critical = new Set(profile.critical_blocks);
  const eligible = Array.from({ length: 96 }, (_, i) => i).filter((i) =>
    i + 1 >= profile.earliest_shift_block && i + 1 <= profile.latest_shift_block && !critical.has(i + 1));
  const sources = [...eligible].sort((a, b) => prices[b] - prices[a] || a - b);
  const destinations = [...eligible].sort((a, b) => prices[a] - prices[b] || a - b);
  let remainingKwh = profile.maximum_shift_energy_kwh_per_day;
  let destinationCursor = 0;
  let sourceBlocksUsed = 0;
  const transfers: Array<{ source: number; destination: number; kw: number }> = [];
  for (const source of sources) {
    if (remainingKwh <= 1e-9 || sourceBlocksUsed >= profile.maximum_shift_duration_blocks) break;
    const minLoad = profile.minimum_operating_load_kw ?? 0;
    let sourceCapacity = Math.min(profile.flexible_load_kw, profile.maximum_downward_shift_kw_per_block,
      Math.max(0, baseline[source] - minLoad), remainingKwh / 0.25);
    if (sourceCapacity <= 1e-9) continue;
    let usedSource = false;
    while (sourceCapacity > 1e-9 && destinationCursor < destinations.length && remainingKwh > 1e-9) {
      const destination = destinations[destinationCursor];
      if (prices[destination] >= prices[source] || destination === source) { destinationCursor++; continue; }
      const maxLoad = profile.maximum_operating_load_kw ?? Number.POSITIVE_INFINITY;
      const destinationCapacity = Math.min(profile.maximum_upward_shift_kw_per_block,
        Math.max(0, maxLoad - baseline[destination]) - delta[destination]);
      if (destinationCapacity <= 1e-9) { destinationCursor++; continue; }
      const amount = Math.min(sourceCapacity, destinationCapacity, remainingKwh / 0.25);
      delta[source] -= amount;
      delta[destination] += amount;
      sourceCapacity -= amount;
      remainingKwh -= amount * 0.25;
      usedSource = true;
      transfers.push({ source, destination, kw: amount });
      if (destinationCapacity - amount <= 1e-9) destinationCursor++;
    }
    if (usedSource) sourceBlocksUsed++;
  }
  return { delta, transfers };
}

const cost = (load: number[], prices: number[]) => load.reduce((sum, kw, i) => sum + kw * 0.25 * prices[i] / 1000, 0);

export function optimizeGridFlexibility(args: {
  mode: 'LIVE' | 'HISTORICAL_REPLAY'; inputDate: string; targetDate: string;
  forecast: GridForecastResponseContract; prices: Array<{ block_index: number; mcp_rs_per_mwh: number }>;
  priceProvenance: FlexibilityDecision['price_provenance']; profile: SiteFlexibilityProfile;
}): FlexibilityDecision {
  const started = performance.now();
  const profile = validateFlexibilityProfile(args.profile);
  if (!profile) throw new Error('INVALID_FLEXIBILITY_PROFILE');
  if (!args.forecast.forecast_available || args.forecast.validation_status !== 'VALIDATED' || args.forecast.blocks.length !== 96)
    throw new Error('VALIDATED_96_BLOCK_FORECAST_REQUIRED');
  if (args.prices.length !== 96 || args.prices.some((p, i) => p.block_index !== i + 1 || !Number.isFinite(p.mcp_rs_per_mwh) || p.mcp_rs_per_mwh < 0) ||
      args.priceProvenance.delivery_date !== args.targetDate) throw new Error('EXACT_DATE_VERIFIED_IEX_DAM_REQUIRED');
  const baseline = args.forecast.blocks.map((b) => b.forecast_load_kw);
  const prices = args.prices.map((p) => p.mcp_rs_per_mwh);
  const central = optimizeProfile(baseline, prices, profile);
  const optimized = baseline.map((v, i) => v + central.delta[i]);
  const baselineCost = cost(baseline, prices);
  const optimizedCost = cost(optimized, prices);
  const lower = args.forecast.blocks.map((b) => b.lower_bound_kw ?? b.confidence_lower_kw);
  const upper = args.forecast.blocks.map((b) => b.upper_bound_kw ?? b.confidence_upper_kw);
  let uncertainty: FlexibilityDecision['uncertainty_status'] = 'INSUFFICIENT_INTERVAL_EVIDENCE';
  if (lower.every((v): v is number => typeof v === 'number' && Number.isFinite(v)) &&
      upper.every((v): v is number => typeof v === 'number' && Number.isFinite(v))) {
    const lowerDelta = optimizeProfile(lower, prices, profile).delta;
    const upperDelta = optimizeProfile(upper, prices, profile).delta;
    const direction = (v: number) => Math.abs(v) < 1e-7 ? 0 : Math.sign(v);
    uncertainty = central.delta.every((v, i) => direction(v) === 0 ||
      (direction(v) === direction(lowerDelta[i]) && direction(v) === direction(upperDelta[i])))
      ? 'ROBUST' : 'SENSITIVE_TO_FORECAST_UNCERTAINTY';
  }
  const recommendations = central.transfers.map((t) => {
    const energy = t.kw * 0.25;
    const difference = prices[t.source] - prices[t.destination];
    const impact = energy * difference / 1000;
    return { source_blocks: [t.source + 1], destination_blocks: [t.destination + 1], load_delta_kw: t.kw,
      energy_shifted_kwh: energy, mcp_difference_rs_per_mwh: difference, indicative_impact_inr: impact,
      explanation: `Reduce up to ${t.kw.toFixed(2)} kW in block ${t.source + 1} and shift equivalent energy to block ${t.destination + 1}; the configured constraints permit the move and MCP is ₹${difference.toFixed(2)}/MWh lower. Indicative exchange-energy reduction: ₹${impact.toFixed(2)}.` };
  });
  const shiftedEnergy = central.delta.filter((v) => v < 0).reduce((sum, v) => sum + -v * 0.25, 0);
  return { status: 'READY', suppression_reason: null, mode: args.mode, input_date: args.inputDate,
    target_date: args.targetDate, selected_forecast_model: args.forecast.selected_model || args.forecast.model_version,
    forecast_validation_evidence: args.forecast.validation_metrics, drift_status: args.forecast.drift_status || 'INSUFFICIENT_EVIDENCE',
    price_provenance: args.priceProvenance, flexibility_constraints: profile,
    optimization_objective: FLEXIBILITY_OBJECTIVE, component_label: INDICATIVE_COMPONENT_LABEL,
    baseline_profile_kw: baseline, optimized_profile_kw: optimized, delta_kw: central.delta, mcp_rs_per_mwh: prices,
    shifted_energy_kwh: shiftedEnergy, baseline_indicative_component_inr: baselineCost,
    optimized_indicative_component_inr: optimizedCost, indicative_difference_inr: baselineCost - optimizedCost,
    indicative_difference_pct: baselineCost > 0 ? 100 * (baselineCost - optimizedCost) / baselineCost : 0,
    modified_blocks: central.delta.filter((v) => Math.abs(v) > 1e-7).length, recommendations,
    uncertainty_status: uncertainty, runtime_ms: performance.now() - started };
}

export function flexibilityChartData(decision: FlexibilityDecision) {
  return Array.from({ length: 96 }, (_, i) => ({ block_index: i + 1,
    time: blockTimeWindow(i + 1),
    baseline_kw: decision.baseline_profile_kw[i], optimized_kw: decision.optimized_profile_kw[i],
    delta_kw: decision.delta_kw[i], mcp_rs_per_mwh: decision.mcp_rs_per_mwh[i],
    is_source: decision.delta_kw[i] < 0, is_destination: decision.delta_kw[i] > 0 }));
}

export async function resolveFlexibilityDecision(args: {
  client: SupabaseClient; siteId: string; organisationId: string; mode: 'LIVE' | 'HISTORICAL_REPLAY';
  inputDate: string; targetDate: string; forecast: GridForecastResponseContract;
}): Promise<FlexibilityDecision | { status: 'SUPPRESSED'; suppression_reason: string }> {
  const { data: rawProfile, error: profileError } = await args.client.from('site_flexibility_profiles')
    .select('site_id,organisation_id,flexible_load_kw,maximum_shift_energy_kwh_per_day,maximum_upward_shift_kw_per_block,maximum_downward_shift_kw_per_block,earliest_shift_block,latest_shift_block,maximum_shift_duration_blocks,critical_blocks,energy_conservation_required,minimum_operating_load_kw,maximum_operating_load_kw,is_active,updated_at')
    .eq('site_id', args.siteId).maybeSingle();
  if (profileError) throw new Error(`FLEXIBILITY_PROFILE_LOOKUP_FAILED: ${profileError.message}`);
  if (!rawProfile) return { status: 'SUPPRESSED', suppression_reason: 'FLEXIBILITY_PROFILE_REQUIRED' };
  const profile = validateFlexibilityProfile(rawProfile);
  if (!profile || profile.site_id !== args.siteId || profile.organisation_id !== args.organisationId)
    return { status: 'SUPPRESSED', suppression_reason: 'INVALID_FLEXIBILITY_PROFILE' };
  const { data: priceRows, error: priceError } = await args.client.from('market_price_blocks')
    .select('import_id,delivery_date,block_index,mcp_rs_per_mwh,source_reference,source_file_hash,provenance_status,verification_status')
    .eq('exchange', 'IEX').eq('market_product', 'DAM').eq('delivery_date', args.targetDate).order('block_index');
  if (priceError) throw new Error(`FLEXIBILITY_PRICE_LOOKUP_FAILED: ${priceError.message}`);
  if (priceRows?.length !== 96 || priceRows.some((row, index) => Number(row.block_index) !== index + 1 ||
      row.delivery_date !== args.targetDate || row.verification_status !== 'VERIFIED' ||
      row.provenance_status !== 'OFFICIAL_SOURCE_CONFIRMED' || !row.source_reference || !row.source_file_hash))
    return { status: 'SUPPRESSED', suppression_reason: 'EXACT_DATE_VERIFIED_IEX_DAM_REQUIRED' };
  return optimizeGridFlexibility({ mode: args.mode, inputDate: args.inputDate, targetDate: args.targetDate,
    forecast: args.forecast, prices: priceRows.map((row) => ({ block_index: Number(row.block_index),
      mcp_rs_per_mwh: Number(row.mcp_rs_per_mwh) })), profile,
    priceProvenance: { import_id: String(priceRows[0].import_id), source_reference: String(priceRows[0].source_reference),
      source_file_hash: String(priceRows[0].source_file_hash), delivery_date: args.targetDate } });
}
