import type { SupabaseClient } from '@supabase/supabase-js';
import type { BESSBehindMeterResponseContract, GridForecastResponseContract } from '@/types/analytics-contracts';
import { fetchBESSBehindMeterDispatch } from '@/lib/analytics/client';

export const BESS_SIMULATION_LABEL = 'BEHIND-THE-METER BESS ENERGY-SHIFT SIMULATION';
export const BESS_COMPONENT_LABEL = 'INDICATIVE IEX DAM ENERGY COMPONENT';

export interface SiteBessSimulationProfile {
  site_id: string; organisation_id: string;
  nameplate_energy_capacity_kwh: number; max_charge_power_kw: number; max_discharge_power_kw: number;
  minimum_soc_percent: number; maximum_soc_percent: number; initial_soc_percent: number;
  final_soc_requirement: 'RETURN_TO_INITIAL_SOC' | 'MINIMUM_FINAL_SOC'; final_soc_percent: number | null;
  charge_efficiency_percent: number; discharge_efficiency_percent: number;
  maximum_daily_throughput_kwh: number; degradation_cost_rs_per_kwh_throughput: number;
  available_blocks: number[] | null; is_active: boolean; updated_at?: string;
}

const fields = 'site_id,organisation_id,nameplate_energy_capacity_kwh,max_charge_power_kw,max_discharge_power_kw,minimum_soc_percent,maximum_soc_percent,initial_soc_percent,final_soc_requirement,final_soc_percent,charge_efficiency_percent,discharge_efficiency_percent,maximum_daily_throughput_kwh,degradation_cost_rs_per_kwh_throughput,available_blocks,is_active,updated_at';

export function validateBessProfile(value: unknown): SiteBessSimulationProfile | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as SiteBessSimulationProfile;
  const numbers = ['nameplate_energy_capacity_kwh','max_charge_power_kw','max_discharge_power_kw','maximum_daily_throughput_kwh'] as const;
  const percentages = ['minimum_soc_percent','maximum_soc_percent','initial_soc_percent','charge_efficiency_percent','discharge_efficiency_percent'] as const;
  if (!numbers.every((key) => Number.isFinite(Number(p[key])) && Number(p[key]) > 0) ||
      !percentages.every((key) => Number.isFinite(Number(p[key])) && Number(p[key]) >= 0 && Number(p[key]) <= 100) ||
      Number(p.minimum_soc_percent) >= Number(p.maximum_soc_percent) || Number(p.initial_soc_percent) < Number(p.minimum_soc_percent) ||
      Number(p.initial_soc_percent) > Number(p.maximum_soc_percent) || Number(p.charge_efficiency_percent) <= 0 ||
      Number(p.discharge_efficiency_percent) <= 0 || !Number.isFinite(Number(p.degradation_cost_rs_per_kwh_throughput)) ||
      Number(p.degradation_cost_rs_per_kwh_throughput) < 0 || p.is_active !== true ||
      !['RETURN_TO_INITIAL_SOC','MINIMUM_FINAL_SOC'].includes(p.final_soc_requirement)) return null;
  const final = p.final_soc_percent;
  if (p.final_soc_requirement === 'MINIMUM_FINAL_SOC' &&
      (final === null || !Number.isFinite(Number(final)) || Number(final) < Number(p.minimum_soc_percent) || Number(final) > Number(p.maximum_soc_percent))) return null;
  if (p.available_blocks !== null && (!Array.isArray(p.available_blocks) || new Set(p.available_blocks).size !== p.available_blocks.length ||
      p.available_blocks.some((block) => !Number.isInteger(Number(block)) || block < 1 || block > 96))) return null;
  return { ...p, ...Object.fromEntries([...numbers, ...percentages].map((key) => [key, Number(p[key])])),
    degradation_cost_rs_per_kwh_throughput: Number(p.degradation_cost_rs_per_kwh_throughput),
    final_soc_percent: final === null ? null : Number(final),
    available_blocks: p.available_blocks === null ? null : p.available_blocks.map(Number) } as SiteBessSimulationProfile;
}

export function validBessSimulationResponse(value: unknown, siteId: string, date: string): value is BESSBehindMeterResponseContract {
  if (!value || typeof value !== 'object') return false;
  const r = value as BESSBehindMeterResponseContract;
  const arrays = [r.baseline_load_kw,r.optimized_grid_import_kw,r.charge_kw,r.discharge_kw,r.soc_kwh,r.soc_pct,r.mcp_inr_per_mwh];
  return r.site_id === siteId && r.operating_date === date && r.solver_version === 'BESS_BEHIND_METER_SCIPY_MILP_v1.0' &&
    r.simulation_label === BESS_SIMULATION_LABEL && arrays.every((array) => Array.isArray(array) && array.length === 96 && array.every(Number.isFinite)) &&
    r.charge_kw.every((charge, index) => charge <= 1e-6 || r.discharge_kw[index] <= 1e-6) &&
    r.optimized_grid_import_kw.every((value) => value >= -1e-6) && Number.isFinite(r.net_indicative_benefit_inr);
}

export async function loadBessProfile(client: SupabaseClient, siteId: string, organisationId: string) {
  const { data, error } = await client.from('site_bess_simulation_profiles').select(fields).eq('site_id', siteId).maybeSingle();
  if (error) throw new Error(`BESS_PROFILE_LOOKUP_FAILED: ${error.message}`);
  const profile = validateBessProfile(data);
  return profile?.organisation_id === organisationId ? profile : null;
}

export async function runBessSimulation(args: { client: SupabaseClient; siteId: string; organisationId: string;
  targetDate: string; forecast: GridForecastResponseContract; historicalReplay: boolean }) {
  const profile = await loadBessProfile(args.client, args.siteId, args.organisationId);
  if (!profile) return { status: 'SUPPRESSED', suppression_reason: 'BESS_PROFILE_REQUIRED' };
  if (!args.forecast.forecast_available || args.forecast.blocks.length !== 96) {
    return { status: 'SUPPRESSED', suppression_reason: 'VALIDATED_96_BLOCK_FORECAST_REQUIRED' };
  }
  if (!args.historicalReplay && args.forecast.freshness !== 'RECENT') {
    return { status: 'SUPPRESSED', suppression_reason: 'RECENT_LIVE_FORECAST_REQUIRED' };
  }
  const { data: prices, error } = await args.client.from('market_price_blocks')
    .select('block_index,mcp_rs_per_mwh,source_reference,source_file_hash,provenance_status,verification_status')
    .eq('exchange','IEX').eq('market_product','DAM').eq('delivery_date',args.targetDate).order('block_index');
  if (error) throw new Error(`BESS_PRICE_LOOKUP_FAILED: ${error.message}`);
  if (!prices || prices.length !== 96 || prices.some((row, index) => Number(row.block_index) !== index + 1 ||
      row.provenance_status !== 'OFFICIAL_SOURCE_CONFIRMED' || row.verification_status !== 'VERIFIED')) {
    return { status: 'SUPPRESSED', suppression_reason: 'EXACT_DATE_VERIFIED_IEX_DAM_REQUIRED' };
  }
  const blocks = args.forecast.blocks;
  const response = await fetchBESSBehindMeterDispatch({ profileId: args.siteId, siteId: args.siteId,
    operatingDate: args.targetDate, profile: { ...profile }, forecastLoadKw: blocks.map((block) => block.forecast_load_kw),
    forecastLowerKw: blocks.every((block) => Number.isFinite(block.confidence_lower_kw))
      ? blocks.map((block) => Number(block.confidence_lower_kw)) : null,
    forecastUpperKw: blocks.every((block) => Number.isFinite(block.confidence_upper_kw))
      ? blocks.map((block) => Number(block.confidence_upper_kw)) : null,
    pricesInrPerMwh: prices.map((row) => Number(row.mcp_rs_per_mwh)),
    priceSourceReference: prices[0].source_reference, priceSourceFileHash: prices[0].source_file_hash,
    forecastModelVersion: args.forecast.model_version, forecastSelectedModel: args.forecast.selected_model || 'UNAVAILABLE',
    forecastDriftStatus: args.forecast.drift_status || 'INSUFFICIENT_EVIDENCE' });
  if (!validBessSimulationResponse(response, args.siteId, args.targetDate)) throw new Error('INVALID_BESS_ANALYTICS_CONTRACT');
  return response;
}

export function groupBessDispatch(result: BESSBehindMeterResponseContract) {
  const groups: Array<{ action: 'CHARGE' | 'DISCHARGE'; start_block: number; end_block: number; energy_kwh: number; peak_power_kw: number }> = [];
  result.charge_kw.forEach((charge, index) => {
    const discharge = result.discharge_kw[index]; const action = charge > 1e-6 ? 'CHARGE' : discharge > 1e-6 ? 'DISCHARGE' : null;
    if (!action) return;
    const power = action === 'CHARGE' ? charge : discharge; const previous = groups.at(-1);
    if (previous?.action === action && previous.end_block === index) {
      previous.end_block = index + 1; previous.energy_kwh += power * 0.25; previous.peak_power_kw = Math.max(previous.peak_power_kw, power);
    } else groups.push({ action, start_block: index + 1, end_block: index + 1, energy_kwh: power * 0.25, peak_power_kw: power });
  });
  return groups;
}
