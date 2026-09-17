import 'server-only';
import type { BESSSizingResponseContract, GridForecastResponseContract } from '@/types/analytics-contracts';
import type { SiteBessSimulationProfile } from '@/lib/analytics/bess-simulation';
import { fetchBESSSizing } from '@/lib/analytics/client';

export const MAX_BESS_SIZING_CANDIDATES = 30;

export function validateSizingCandidates(capacities: unknown, powers: unknown) {
  if (!Array.isArray(capacities) || !Array.isArray(powers) || capacities.length === 0 || powers.length === 0 ||
      capacities.length * powers.length > MAX_BESS_SIZING_CANDIDATES) return null;
  const capacityValues = capacities.map(Number); const powerValues = powers.map(Number);
  if ([...capacityValues,...powerValues].some((value) => !Number.isFinite(value) || value <= 0) ||
      new Set(capacityValues).size !== capacityValues.length || new Set(powerValues).size !== powerValues.length) return null;
  return { capacities: [...capacityValues].sort((a,b)=>a-b), powers: [...powerValues].sort((a,b)=>a-b) };
}

export function validSizingResponse(value: unknown, siteId: string, date: string,
  expectedCount: number): value is BESSSizingResponseContract {
  if (!value || typeof value !== 'object') return false;
  const result=value as BESSSizingResponseContract;
  return result.site_id===siteId && result.operating_date===date && result.analyzed_days===1 &&
    result.analysis_label==='HISTORICAL BESS SIZING SCREEN' && result.candidate_count===expectedCount &&
    Array.isArray(result.candidates) && result.candidates.length===expectedCount &&
    result.candidates.every((candidate)=>candidate.capacity_kwh>0 && candidate.power_kw>0 &&
      Number.isFinite(candidate.net_indicative_benefit_inr) && candidate.dispatch.site_id===siteId &&
      candidate.dispatch.operating_date===date && candidate.dispatch.optimized_grid_import_kw.length===96 &&
      candidate.dispatch.optimized_grid_import_kw.every((load)=>load>=-1e-6));
}

export async function requestBessSizing(args:{siteId:string;targetDate:string;profile:SiteBessSimulationProfile;
  forecast:GridForecastResponseContract;prices:Array<{block_index:number;mcp_rs_per_mwh:number;source_reference:string;
    source_file_hash:string;provenance_status:string;verification_status:string}>;capacities:number[];powers:number[]}) {
  const blocks=args.forecast.blocks;
  const lowerBounds=blocks.map(block=>block.confidence_lower_kw??block.lower_bound_kw);
  const upperBounds=blocks.map(block=>block.confidence_upper_kw??block.upper_bound_kw);
  const result=await fetchBESSSizing({baseProfileId:args.siteId,siteId:args.siteId,operatingDate:args.targetDate,
    profile:{...args.profile},capacityCandidatesKwh:args.capacities,powerCandidatesKw:args.powers,
    forecastLoadKw:blocks.map((block)=>block.forecast_load_kw),
    forecastLowerKw:lowerBounds.every(value=>Number.isFinite(value))?lowerBounds.map(Number):null,
    forecastUpperKw:upperBounds.every(value=>Number.isFinite(value))?upperBounds.map(Number):null,
    pricesInrPerMwh:args.prices.map((row)=>Number(row.mcp_rs_per_mwh)),
    priceSourceReference:args.prices[0].source_reference,priceSourceFileHash:args.prices[0].source_file_hash,
    forecastModelVersion:args.forecast.model_version,forecastSelectedModel:args.forecast.selected_model||'UNAVAILABLE',
    forecastDriftStatus:args.forecast.drift_status||'INSUFFICIENT_EVIDENCE'});
  if(!validSizingResponse(result,args.siteId,args.targetDate,args.capacities.length*args.powers.length))
    throw new Error('INVALID_BESS_SIZING_ANALYTICS_CONTRACT');
  return result;
}
