import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GridHistoricalDay } from '@/lib/analytics/grid-input-evidence';

export const MIN_BESS_SIZING_HISTORY_DAYS = 42;
export interface BessSizingPriceEvidenceRow {
  delivery_date: string; block_index: number; verification_status: string;
  provenance_status: string; mcp_rs_per_mwh: number | string | null;
}
export interface BessSizingEvidenceDay {
  date: string; eligible: boolean; forecast_ready: boolean; price_blocks: number;
  price_verification: 'VERIFIED'|'UNVERIFIED'|'INCOMPLETE'; reason_if_ineligible: string|null;
}

const previousDate=(date:string)=>new Date(Date.parse(`${date}T00:00:00Z`)-86400000).toISOString().slice(0,10);

export function buildBessSizingEvidenceCatalog(history: GridHistoricalDay[], prices: BessSizingPriceEvidenceRow[],
  profileExists: boolean, beforeDate: string): BessSizingEvidenceDay[] {
  const historyDates=[...new Set(history.map(day=>day.operating_date))].sort();
  const byDate=new Map<string,BessSizingPriceEvidenceRow[]>();
  for(const row of prices){const rows=byDate.get(row.delivery_date)||[];rows.push(row);byDate.set(row.delivery_date,rows);}
  return [...byDate.entries()].filter(([date])=>date<beforeDate).sort(([a],[b])=>a.localeCompare(b)).map(([date,rows])=>{
    const prior=historyDates.filter(value=>value<date);const latest=prior.at(-1)||null;
    const forecastReady=prior.length>=MIN_BESS_SIZING_HISTORY_DAYS&&latest===previousDate(date);
    const blocks=new Set(rows.map(row=>Number(row.block_index)).filter(block=>Number.isInteger(block)&&block>=1&&block<=96));
    const verified=rows.length===96&&blocks.size===96&&rows.every(row=>row.verification_status==='VERIFIED'&&
      row.provenance_status==='OFFICIAL_SOURCE_CONFIRMED'&&Number.isFinite(Number(row.mcp_rs_per_mwh)));
    const priceVerification=verified?'VERIFIED':blocks.size===96?'UNVERIFIED':'INCOMPLETE';
    const reason=!profileExists?'BESS_PROFILE_REQUIRED':!forecastReady?'INSUFFICIENT_OR_NONCONTIGUOUS_FORECAST_HISTORY':
      !verified?(blocks.size!==96?'INCOMPLETE_96_BLOCK_IEX_DAM':'UNVERIFIED_IEX_DAM_EVIDENCE'):null;
    return {date,eligible:reason===null,forecast_ready:forecastReady,price_blocks:blocks.size,
      price_verification:priceVerification,reason_if_ineligible:reason};
  });
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
