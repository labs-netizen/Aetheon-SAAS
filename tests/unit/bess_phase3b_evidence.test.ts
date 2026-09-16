import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runBessSimulation } from '@/lib/analytics/bess-simulation';
import type { GridForecastResponseContract } from '@/types/analytics-contracts';

vi.mock('server-only',()=>({}));

const analytics=vi.hoisted(()=>({dispatch:vi.fn()}));
vi.mock('@/lib/analytics/client',()=>({fetchBESSBehindMeterDispatch:analytics.dispatch}));

const profile={site_id:'site-1',organisation_id:'org-1',nameplate_energy_capacity_kwh:2000,max_charge_power_kw:500,max_discharge_power_kw:500,
  minimum_soc_percent:20,maximum_soc_percent:90,initial_soc_percent:50,final_soc_requirement:'RETURN_TO_INITIAL_SOC',final_soc_percent:null,
  charge_efficiency_percent:95,discharge_efficiency_percent:95,maximum_daily_throughput_kwh:2000,
  degradation_cost_rs_per_kwh_throughput:0.5,available_blocks:null,is_active:true};
const prices=Array.from({length:96},(_,index)=>({block_index:index+1,mcp_rs_per_mwh:index<48?2500:9000,
  source_reference:'IEX DAM',source_file_hash:'a'.repeat(64),provenance_status:'OFFICIAL_SOURCE_CONFIRMED',verification_status:'VERIFIED'}));
const forecast={site_id:'site-1',operating_date:'2026-05-01',forecast_available:true,forecast_status:'AVAILABLE',model_status:'VALIDATED',validation_status:'VALIDATED',model_version:'GRID_HISTORICAL_LOAD_V2.0',model_generation_time:'2026-04-30T00:00:00Z',training_start_date:'2025-01-01',training_end_date:'2026-04-30',latest_input_date:'2026-04-30',forecast_target_date:'2026-05-01',freshness_days:1,selected_model:'RIDGE',validation_metrics:null,baseline_metrics:{},provenance:{input_source:'COMMITTED_INTERVAL_DATA_96',model_family:'DAY_AHEAD_DEMAND',validation_method:'WALK_FORWARD',price_source:null},average_price_inr_per_mwh:null,peak_demand_kw:10000,peak_demand_block:80,blocks:Array.from({length:96},(_,index)=>({block_index:index+1,start_time:'00:00',end_time:'00:15',forecast_load_kw:10000,forecast_price_inr_per_mwh:null,confidence_lower_kw:9000,confidence_upper_kw:11000,is_high_cost_window:null})),is_suppressed:false,suppression_reason:null,confidence_status:'EMPIRICAL_INTERVAL_AVAILABLE',data_quality:'PASSED',freshness:'RECENT',price_status:'AUTHORITATIVE_PRICE_FEED_REQUIRED',drift_status:'DRIFT_WARNING'} satisfies GridForecastResponseContract;

function client(profileValue:unknown=profile,priceValue:unknown[]=prices){
  return {from:(table:string)=>table==='site_bess_simulation_profiles'?{select:()=>({eq:()=>({maybeSingle:async()=>({data:profileValue,error:null})})})}:{select:()=>({eq:()=>({eq:()=>({eq:()=>({order:async()=>({data:priceValue,error:null})})})})})}} as any;
}

describe('Phase 3B evidence gates',()=>{
  beforeEach(()=>analytics.dispatch.mockReset());
  it('requires an explicit profile',async()=>{expect(await runBessSimulation({client:client(null),siteId:'site-1',organisationId:'org-1',targetDate:'2026-05-01',forecast,historicalReplay:false})).toEqual({status:'SUPPRESSED',suppression_reason:'BESS_PROFILE_REQUIRED'});});
  it('rejects incomplete or unverified exact-date MCP evidence before analytics',async()=>{
    expect((await runBessSimulation({client:client(profile,prices.slice(1)),siteId:'site-1',organisationId:'org-1',targetDate:'2026-05-01',forecast,historicalReplay:false}) as any).suppression_reason).toBe('EXACT_DATE_VERIFIED_IEX_DAM_REQUIRED');
    expect((await runBessSimulation({client:client(profile,prices.map((row,index)=>index?row:{...row,verification_status:'UNVERIFIED'})),siteId:'site-1',organisationId:'org-1',targetDate:'2026-05-01',forecast,historicalReplay:false}) as any).suppression_reason).toBe('EXACT_DATE_VERIFIED_IEX_DAM_REQUIRED');
    expect(analytics.dispatch).not.toHaveBeenCalled();
  });
  it('suppresses stale live evidence but permits the same validated historical replay evidence',async()=>{
    const stale={...forecast,freshness:'STALE' as const};
    expect((await runBessSimulation({client:client(),siteId:'site-1',organisationId:'org-1',targetDate:'2026-05-01',forecast:stale,historicalReplay:false}) as any).suppression_reason).toBe('RECENT_LIVE_FORECAST_REQUIRED');
    analytics.dispatch.mockResolvedValue({site_id:'bad'});
    await expect(runBessSimulation({client:client(),siteId:'site-1',organisationId:'org-1',targetDate:'2026-05-01',forecast:stale,historicalReplay:true})).rejects.toThrow('INVALID_BESS_ANALYTICS_CONTRACT');
    expect(analytics.dispatch).toHaveBeenCalledOnce();
  });
  it('passes drift and empirical intervals to the solver without rerunning forecasting',async()=>{
    analytics.dispatch.mockResolvedValue({site_id:'bad'});
    await expect(runBessSimulation({client:client(),siteId:'site-1',organisationId:'org-1',targetDate:'2026-05-01',forecast,historicalReplay:false})).rejects.toThrow();
    expect(analytics.dispatch).toHaveBeenCalledWith(expect.objectContaining({forecastDriftStatus:'DRIFT_WARNING',forecastLowerKw:Array(96).fill(9000),forecastUpperKw:Array(96).fill(11000)}));
  });
});
