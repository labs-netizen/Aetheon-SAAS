import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { validateBessProfile, validBessSimulationResponse } from '@/lib/analytics/bess-simulation';
import { BESS_SIMULATION_LABEL, groupBessDispatch } from '@/lib/analytics/bess-presentation';
import type { BESSBehindMeterResponseContract } from '@/types/analytics-contracts';

const profile = { site_id:'site-1',organisation_id:'org-1',nameplate_energy_capacity_kwh:2000,max_charge_power_kw:500,
  max_discharge_power_kw:500,minimum_soc_percent:20,maximum_soc_percent:90,initial_soc_percent:50,final_soc_requirement:'RETURN_TO_INITIAL_SOC' as const,
  final_soc_percent:null,charge_efficiency_percent:95,discharge_efficiency_percent:95,maximum_daily_throughput_kwh:2000,
  degradation_cost_rs_per_kwh_throughput:0.5,available_blocks:null,is_active:true };

function response(): BESSBehindMeterResponseContract {
  const zeros=Array(96).fill(0);const load=Array(96).fill(10000);const soc=Array(96).fill(50);
  return { profile_id:'site-1',site_id:'site-1',operating_date:'2026-05-01',solver_version:'BESS_BEHIND_METER_SCIPY_MILP_v1.0',
    simulation_label:BESS_SIMULATION_LABEL,status:'DISPATCH_IDENTIFIED',suppression_reason:null,feasibility_verified:true,
    uncertainty_status:'ROBUST',drift_status:'NORMAL',baseline_load_kw:load,optimized_grid_import_kw:[...load],charge_kw:[...zeros],
    discharge_kw:[...zeros],soc_kwh:Array(96).fill(1000),soc_pct:soc,mcp_inr_per_mwh:Array(96).fill(5000),
    baseline_iex_component_inr:120000,battery_iex_component_inr:119000,gross_iex_component_reduction_inr:1000,
    degradation_cost_inr:200,net_indicative_benefit_inr:800,throughput_kwh:400,equivalent_full_cycles:0.1,
    minimum_soc_pct_observed:40,maximum_soc_pct_observed:60,final_soc_pct:50,charge_blocks:[],discharge_blocks:[],
    scenario_net_benefit_inr:{CENTRAL:800,LOWER:800,UPPER:800},profile:{...profile},provenance:{},safety_disclaimer:'Advisory only.' };
}

describe('Phase 3B behind-the-meter BESS contract',()=>{
  it('requires every explicit battery parameter and never infers a profile',()=>{
    expect(validateBessProfile(profile)).not.toBeNull();
    expect(validateBessProfile({...profile,nameplate_energy_capacity_kwh:undefined})).toBeNull();
    expect(validateBessProfile({...profile,initial_soc_percent:95})).toBeNull();
    expect(validateBessProfile({...profile,final_soc_requirement:'MINIMUM_FINAL_SOC',final_soc_percent:null})).toBeNull();
  });
  it('accepts only complete physical arrays and rejects simultaneous charge/discharge',()=>{
    expect(validBessSimulationResponse(response(),'site-1','2026-05-01')).toBe(true);
    const short=response();short.soc_pct=short.soc_pct.slice(1);expect(validBessSimulationResponse(short,'site-1','2026-05-01')).toBe(false);
    const dual=response();dual.charge_kw[0]=10;dual.discharge_kw[0]=10;expect(validBessSimulationResponse(dual,'site-1','2026-05-01')).toBe(false);
    const exporting=response();exporting.optimized_grid_import_kw[4]=-1;expect(validBessSimulationResponse(exporting,'site-1','2026-05-01')).toBe(false);
  });
  it('groups only consecutive compatible simulated actions without changing energy totals',()=>{
    const value=response();value.charge_kw[0]=100;value.charge_kw[1]=200;value.charge_kw[3]=100;value.discharge_kw[10]=300;
    const groups=groupBessDispatch(value);
    expect(groups.map(({action,start_block,end_block})=>({action,start_block,end_block}))).toEqual([
      {action:'CHARGE',start_block:1,end_block:2},{action:'CHARGE',start_block:4,end_block:4},{action:'DISCHARGE',start_block:11,end_block:11}]);
    expect(groups.reduce((sum,group)=>sum+group.energy_kwh,0)).toBe(175);
  });
  it('keeps gross, degradation and net economics separately auditable',()=>{
    const value=response();expect(value.net_indicative_benefit_inr).toBe(value.gross_iex_component_reduction_inr-value.degradation_cost_inr);
    expect(value.safety_disclaimer).not.toMatch(/guaranteed|autonomous dispatch/i);
  });
});
