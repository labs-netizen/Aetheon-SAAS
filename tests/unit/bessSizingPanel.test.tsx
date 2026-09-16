import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase/client',()=>({createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'token'}}})}})}));
vi.mock('@/features/bess/BessSimulationPanel',()=>({BessSimulationPanel:({historical}:{historical:boolean})=><div data-testid="mock-candidate-dispatch">{historical?'historical candidate dispatch':'live'}</div>}));
import { HistoricalBessSizingPanel } from '@/features/bess/HistoricalBessSizingPanel';

const candidate={capacity_kwh:500,power_kw:250,duration_hours:2,energy_charged_kwh:100,energy_discharged_kwh:90,
  throughput_kwh:190,maximum_throughput_kwh:500,equivalent_full_cycles:.19,minimum_soc_percent:20,maximum_soc_percent:80,
  final_soc_percent:48,charge_power_utilization_percent:80,discharge_power_utilization_percent:70,
  throughput_utilization_percent:38,usable_energy_utilization_percent:60,baseline_iex_component_inr:100,
  battery_iex_component_inr:80,gross_iex_component_reduction_inr:25,degradation_cost_inr:5,
  net_indicative_benefit_inr:20,net_benefit_per_kwh_capacity:.04,net_benefit_per_kw_power:.08,no_action:false,
  uncertainty_status:'ROBUST',drift_status:'NORMAL',pareto_status:'PARETO_EFFICIENT',solve_runtime_ms:2,dispatch:{}};
const result={site_id:'site-1',operating_date:'2026-05-01',analysis_label:'HISTORICAL BESS SIZING SCREEN',analyzed_days:1,
  evidence_warning:'SINGLE-DAY HISTORICAL SIZING SCREEN — NOT SUFFICIENT FOR INVESTMENT SIZING',base_profile_id:'site-1',
  base_max_efc_per_day:.5,candidate_count:1,candidates:[candidate],marginal_values:[],best_candidate:candidate,
  best_per_kwh_candidate:candidate,best_per_kw_candidate:candidate,compact_value_candidate:candidate,pareto_efficient_count:1,
  dominated_count:0,uncertainty_result:'ROBUST',total_runtime_ms:2,median_candidate_runtime_ms:2,
  component_label:'INDICATIVE IEX DAM ENERGY COMPONENT',safety_disclaimer:'THIS IS NOT AN INVESTMENT RECOMMENDATION.'};

describe('HistoricalBessSizingPanel',()=>{
  afterEach(()=>vi.unstubAllGlobals());
  it('renders the heatmap and reuses historical candidate detail after a sizing response',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({result})}));
    const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
    await act(async()=>root.render(<HistoricalBessSizingPanel siteId="site-1"/>));
    const date=container.querySelector('[aria-label="Sizing input date"]') as HTMLInputElement;
    await act(async()=>Simulate.change(date,{target:{value:'2026-04-30'} as any}));
    const buttons=[...container.querySelectorAll('button')];const run=buttons.find(button=>button.textContent?.includes('RUN HISTORICAL'))!;
    await act(async()=>{Simulate.click(run);await Promise.resolve();await Promise.resolve();});
    expect(fetch).toHaveBeenCalledWith('/api/bess/sizing',expect.objectContaining({method:'POST'}));
    expect(container.querySelector('[data-testid="sizing-cell-500-250"]')?.textContent).toContain('₹20');
    expect(container.querySelector('[data-testid="sizing-candidate-detail"]')?.textContent).toContain('500 kWh / 250 kW');
    expect(container.querySelector('[data-testid="mock-candidate-dispatch"]')?.textContent).toContain('historical');
    await act(async()=>root.unmount());container.remove();
  });
});
