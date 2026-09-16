import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { validateSizingCandidates, validSizingResponse } from '@/lib/analytics/bess-sizing';
import { BESS_SIZING_LABEL, BESS_SIZING_WARNING, candidateName, sizingHeatmap } from '@/lib/analytics/bess-sizing-presentation';
import type { BESSSizingResponseContract } from '@/types/analytics-contracts';
import fs from 'node:fs';

const siteId='b4233eac-4f81-4bd2-bab7-8f4e1b1314ab';
const candidate=(capacity:number,power:number,net:number)=>({capacity_kwh:capacity,power_kw:power,duration_hours:capacity/power,
  energy_charged_kwh:1,energy_discharged_kwh:1,throughput_kwh:2,maximum_throughput_kwh:capacity,
  equivalent_full_cycles:0.1,minimum_soc_percent:20,maximum_soc_percent:90,final_soc_percent:48,
  charge_power_utilization_percent:10,discharge_power_utilization_percent:10,throughput_utilization_percent:1,
  usable_energy_utilization_percent:1,baseline_iex_component_inr:10,battery_iex_component_inr:9,
  gross_iex_component_reduction_inr:2,degradation_cost_inr:1,net_indicative_benefit_inr:net,
  net_benefit_per_kwh_capacity:net/capacity,net_benefit_per_kw_power:net/power,no_action:false,
  uncertainty_status:'ROBUST',drift_status:'NORMAL',pareto_status:'PARETO_EFFICIENT' as const,solve_runtime_ms:1,
  dispatch:{site_id:siteId,operating_date:'2026-05-01',optimized_grid_import_kw:Array(96).fill(1)} as any});
const response={site_id:siteId,operating_date:'2026-05-01',analysis_label:BESS_SIZING_LABEL,analyzed_days:1,
  evidence_warning:BESS_SIZING_WARNING,base_profile_id:siteId,base_max_efc_per_day:.5,candidate_count:2,
  candidates:[candidate(500,250,20),candidate(1000,500,40)]} as BESSSizingResponseContract;

describe('historical BESS sizing contract and presentation',()=>{
  it('accepts the bounded 24-candidate grid and sorts values',()=>{
    expect(validateSizingCandidates([4000,500,1000,1500,2000,3000],[1000,250,500,750])).toEqual({
      capacities:[500,1000,1500,2000,3000,4000],powers:[250,500,750,1000]});
  });
  it('rejects invalid, duplicate, and over-30 candidate grids',()=>{
    expect(validateSizingCandidates([500,500],[250])).toBeNull();
    expect(validateSizingCandidates([500,-1],[250])).toBeNull();
    expect(validateSizingCandidates(Array.from({length:8},(_,i)=>i+1),[1,2,3,4])).toBeNull();
  });
  it('validates site/date/count and the embedded 96-block non-export dispatch',()=>{
    expect(validSizingResponse(response,siteId,'2026-05-01',2)).toBe(true);
    const malformed=structuredClone(response);malformed.candidates[0].dispatch.optimized_grid_import_kw=[];
    expect(validSizingResponse(malformed,siteId,'2026-05-01',2)).toBe(false);
  });
  it('builds a true relative heatmap and auditable candidate names',()=>{
    expect(sizingHeatmap(response).map(item=>item.intensity)).toEqual([.5,1]);
    expect(candidateName(response.candidates[0])).toBe('500 kWh / 250 kW');
  });
  it('retains single-day safety labels and investment-language exclusions in the UI',()=>{
    const source=fs.readFileSync('src/features/bess/HistoricalBessSizingPanel.tsx','utf8')+
      fs.readFileSync('src/lib/analytics/bess-sizing-presentation.ts','utf8');
    expect(source).toContain('SINGLE-DAY HISTORICAL SIZING SCREEN');
    expect(source).toContain('NOT SUFFICIENT FOR INVESTMENT SIZING');
    expect(source).toContain('THIS IS NOT AN INVESTMENT RECOMMENDATION');
    expect(source).toContain('NOT LANDED ELECTRICITY COST');
    expect(source).not.toMatch(/guaranteed savings|purchase recommendation/i);
  });
});
