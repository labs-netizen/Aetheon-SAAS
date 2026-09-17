import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadGridHistoricalInput,resolveGridInputEvidence,type GridHistoricalDay } from '@/lib/analytics/grid-input-evidence';
import { loadBessProfile,type SiteBessSimulationProfile } from '@/lib/analytics/bess-simulation';
import { fetchGridForecast } from '@/lib/analytics/client';
import { operatingToday,validGridAnalyticsResponse } from '@/lib/analytics/domain-safety';
import type { GridForecastResponseContract } from '@/types/analytics-contracts';

export const MIN_BESS_SIZING_HISTORY_DAYS = 42;
export interface BessSizingPriceEvidenceRow {
  delivery_date: string; block_index: number; verification_status: string;
  provenance_status: string; mcp_rs_per_mwh: number | string | null;
}
export interface BessSizingEvidenceDay {
  date: string; eligible: boolean; price_verified:boolean; forecast_ready: boolean; price_blocks: number;
  price_verification: 'VERIFIED'|'UNVERIFIED'|'INCOMPLETE';forecast_validation_status:string;
  sizing_ready:boolean;readiness_status:string;reason_if_ineligible: string|null;
}
export interface BessSizingVerifiedPriceRow {block_index:number;mcp_rs_per_mwh:number;source_reference:string;source_file_hash:string;
  provenance_status:string;verification_status:string;}
export interface HistoricalBessSizingReadiness extends BessSizingEvidenceDay {
  input_date:string;profile:SiteBessSimulationProfile|null;forecast:GridForecastResponseContract|null;prices:BessSizingVerifiedPriceRow[];
}

const previousDate=(date:string)=>new Date(Date.parse(`${date}T00:00:00Z`)-86400000).toISOString().slice(0,10);

export function buildBessSizingEvidenceCatalog(history: GridHistoricalDay[], prices: BessSizingPriceEvidenceRow[],
  profileExists: boolean, beforeDate: string): BessSizingEvidenceDay[] {
  const historyDates=[...new Set(history.map(day=>day.operating_date))].sort();
  const byDate=new Map<string,BessSizingPriceEvidenceRow[]>();
  for(const row of prices){const rows=byDate.get(row.delivery_date)||[];rows.push(row);byDate.set(row.delivery_date,rows);}
  return [...byDate.entries()].filter(([date])=>date<beforeDate).sort(([a],[b])=>a.localeCompare(b)).map(([date,rows])=>{
    const prior=historyDates.filter(value=>value<date);const latest=prior.at(-1)||null;
    const historyReady=prior.length>=MIN_BESS_SIZING_HISTORY_DAYS&&latest===previousDate(date);
    const blocks=new Set(rows.map(row=>Number(row.block_index)).filter(block=>Number.isInteger(block)&&block>=1&&block<=96));
    const verified=rows.length===96&&blocks.size===96&&rows.every(row=>row.verification_status==='VERIFIED'&&
      row.provenance_status==='OFFICIAL_SOURCE_CONFIRMED'&&Number.isFinite(Number(row.mcp_rs_per_mwh)));
    const priceVerification=verified?'VERIFIED':blocks.size===96?'UNVERIFIED':'INCOMPLETE';
    const structuralReason=!profileExists?'BESS_PROFILE_REQUIRED':!historyReady?'INSUFFICIENT_LOAD_HISTORY':
      !verified?(blocks.size!==96?'IEX_PRICE_INCOMPLETE':'IEX_PRICE_UNVERIFIED'):'FORECAST_READINESS_NOT_EVALUATED';
    return {date,eligible:false,price_verified:verified,forecast_ready:false,price_blocks:blocks.size,
      price_verification:priceVerification,forecast_validation_status:'NOT_EVALUATED',sizing_ready:false,
      readiness_status:structuralReason,reason_if_ineligible:structuralReason};
  });
}

const suppressedReason=(reason:string|null|undefined)=>reason==='MODEL_VALIDATION_THRESHOLDS_NOT_MET'?'FORECAST_VALIDATION_FAILED':
  reason?.startsWith('INSUFFICIENT_')||reason==='REQUIRED_FORECAST_LAGS_UNAVAILABLE'||reason==='INCOMPLETE_LATEST_OPERATING_DAY'?'INSUFFICIENT_LOAD_HISTORY':'FORECAST_UNAVAILABLE';
const publicDay=(date:string,inputDate:string,reason:string,fields:Partial<HistoricalBessSizingReadiness>={}):HistoricalBessSizingReadiness=>({
  date,input_date:inputDate,eligible:false,price_verified:false,price_blocks:0,price_verification:'INCOMPLETE',forecast_ready:false,
  forecast_validation_status:'NOT_EVALUATED',sizing_ready:false,readiness_status:reason,reason_if_ineligible:reason,
  profile:null,forecast:null,prices:[],...fields});

export async function evaluateHistoricalBessSizingReadiness(args:{client:SupabaseClient;priceClient:SupabaseClient;siteId:string;
  organisationId:string;targetDate:string;contractDemandKw:number;evaluationDate?:string;
  forecastLoader?:typeof fetchGridForecast}):Promise<HistoricalBessSizingReadiness>{
  const inputDate=previousDate(args.targetDate);const forecastLoader=args.forecastLoader||fetchGridForecast;
  const profile=await loadBessProfile(args.client,args.siteId,args.organisationId);
  if(!profile)return publicDay(args.targetDate,inputDate,'BESS_PROFILE_REQUIRED');
  const input=await resolveGridInputEvidence(args.client,args.siteId,inputDate);
  if(!input.is_complete||input.quality_status!=='PASSED')return publicDay(args.targetDate,inputDate,'INSUFFICIENT_LOAD_HISTORY',{profile});
  const history=await loadGridHistoricalInput(args.client,args.siteId,426,inputDate);
  if(history.complete_days.length<MIN_BESS_SIZING_HISTORY_DAYS||history.latest_observed_date!==inputDate||!history.latest_observed_complete||
      history.complete_days.at(-1)?.operating_date!==inputDate)return publicDay(args.targetDate,inputDate,'INSUFFICIENT_LOAD_HISTORY',{profile});
  const {data,error}=await args.priceClient.from('market_price_blocks')
    .select('block_index,mcp_rs_per_mwh,source_reference,source_file_hash,provenance_status,verification_status')
    .eq('exchange','IEX').eq('market_product','DAM').eq('delivery_date',args.targetDate).order('block_index');
  if(error)throw new Error(`BESS_SIZING_PRICE_LOOKUP_FAILED: ${error.message}`);
  const prices=(data||[]) as BessSizingVerifiedPriceRow[];const blocks=new Set(prices.map(row=>Number(row.block_index)).filter(block=>Number.isInteger(block)&&block>=1&&block<=96));
  const verified=prices.length===96&&blocks.size===96&&prices.every((row,index)=>Boolean(Number(row.block_index)===index+1&&
    row.provenance_status==='OFFICIAL_SOURCE_CONFIRMED'&&row.verification_status==='VERIFIED'&&Number.isFinite(Number(row.mcp_rs_per_mwh))&&row.source_reference&&row.source_file_hash));
  if(!verified){const reason=blocks.size!==96?'IEX_PRICE_INCOMPLETE':'IEX_PRICE_UNVERIFIED';return publicDay(args.targetDate,inputDate,reason,{profile,price_blocks:blocks.size,
    price_verification:blocks.size===96?'UNVERIFIED':'INCOMPLETE',price_verified:false});}
  let forecast:GridForecastResponseContract;
  try{forecast=await forecastLoader({isDemo:false,siteId:args.siteId,operatingDate:args.targetDate,contractDemandKw:args.contractDemandKw,
    historicalDays:history.complete_days,evaluationDate:args.evaluationDate||operatingToday(),latestInputComplete:true,historicalReplay:true});}
  catch(error){console.error('Historical BESS sizing forecast readiness failed',{siteId:args.siteId,targetDate:args.targetDate,error:error instanceof Error?error.message:String(error)});
    return publicDay(args.targetDate,inputDate,'FORECAST_UNAVAILABLE',{profile,prices,price_verified:true,price_blocks:96,price_verification:'VERIFIED',forecast_validation_status:'ANALYTICS_ERROR'});}
  if(!validGridAnalyticsResponse(forecast,args.siteId,args.targetDate,'HISTORICAL_REPLAY')||forecast.latest_input_date!==inputDate||forecast.forecast_target_date!==args.targetDate)
    return publicDay(args.targetDate,inputDate,'FORECAST_VALIDATION_FAILED',{profile,forecast,prices,price_verified:true,price_blocks:96,price_verification:'VERIFIED',forecast_validation_status:'INVALID_CONTRACT'});
  if(!forecast.forecast_available||forecast.blocks.length!==96){const reason=suppressedReason(forecast.suppression_reason);return publicDay(args.targetDate,inputDate,reason,{profile,forecast,prices,
    price_verified:true,price_blocks:96,price_verification:'VERIFIED',forecast_validation_status:forecast.validation_status||forecast.model_status});}
  return {date:args.targetDate,input_date:inputDate,eligible:true,price_verified:true,price_blocks:96,price_verification:'VERIFIED',forecast_ready:true,
    forecast_validation_status:forecast.validation_status||'VALIDATED',sizing_ready:true,readiness_status:'READY',reason_if_ineligible:null,profile,forecast,prices};
}

export async function loadBessSizingPriceEvidence(client: SupabaseClient, maximumRows=50000) {
  const rows:BessSizingPriceEvidenceRow[]=[];const pageSize=1000;
  for(let from=0;from<maximumRows;from+=pageSize){
    const {data,error}=await client.from('market_price_blocks')
      .select('delivery_date,block_index,verification_status,provenance_status,mcp_rs_per_mwh')
      .eq('exchange','IEX').eq('market_product','DAM').order('delivery_date').order('block_index')
      .range(from,Math.min(from+pageSize-1,maximumRows-1));
    if(error)throw new Error(`BESS_SIZING_PRICE_EVIDENCE_LOOKUP_FAILED: ${error.message}`);
    rows.push(...((data||[]) as BessSizingPriceEvidenceRow[]));if(!data||data.length<pageSize)return rows;
  }
  throw new Error('BESS_SIZING_PRICE_EVIDENCE_LOOKUP_FAILED: evidence row limit exceeded');
}
