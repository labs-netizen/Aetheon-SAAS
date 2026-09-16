import {describe,expect,it,vi} from 'vitest';
import {aggregateMultiDaySizing,runSequentialSizing} from '@/lib/analytics/bess-multiday';
import type {BESSSizingResponseContract} from '@/types/analytics-contracts';
import fs from 'node:fs';

const candidate=(capacity:number,power:number,net:number,noAction=false,uncertainty='ROBUST')=>({capacity_kwh:capacity,power_kw:power,duration_hours:capacity/power,
  energy_charged_kwh:noAction?0:10,energy_discharged_kwh:noAction?0:9,throughput_kwh:noAction?0:19,maximum_throughput_kwh:capacity,equivalent_full_cycles:noAction?0:.2,
  minimum_soc_percent:20,maximum_soc_percent:80,final_soc_percent:48,charge_power_utilization_percent:noAction?0:50,discharge_power_utilization_percent:noAction?0:40,
  throughput_utilization_percent:noAction?0:20,usable_energy_utilization_percent:noAction?0:30,baseline_iex_component_inr:100,battery_iex_component_inr:100-net,
  gross_iex_component_reduction_inr:net+5,degradation_cost_inr:5,net_indicative_benefit_inr:net,net_benefit_per_kwh_capacity:net/capacity,
  net_benefit_per_kw_power:net/power,no_action:noAction,uncertainty_status:uncertainty,drift_status:'NORMAL',pareto_status:'PARETO_EFFICIENT' as const,
  solve_runtime_ms:1,dispatch:{} as any});
const day=(date:string,values:number[],noAction=false)=>({date,request_runtime_ms:Number(date.slice(-2))*100,result:{site_id:'site',operating_date:date,
  candidates:[candidate(500,250,values[0],noAction),candidate(1000,250,values[1]),candidate(500,500,values[2])],
  best_candidate:{},candidate_count:3} as unknown as BESSSizingResponseContract});

describe('multi-day BESS sizing aggregation',()=>{
  it('calculates distribution, sufficiency, temporal, leader, Pareto and marginal evidence deterministically',()=>{
    const result=aggregateMultiDaySizing([day('2026-01-01',[10,20,9]),day('2026-01-02',[30,25,8]),day('2026-02-07',[20,40,7])])!;
    const small=result.candidates.find(item=>item.capacity_kwh===500&&item.power_kw===250)!;
    expect(small).toMatchObject({analyzed_days:3,mean_daily_net_benefit:20,median_daily_net_benefit:20,
      minimum_daily_net_benefit:10,maximum_daily_net_benefit:30,p10_daily_net_benefit:12,p90_daily_net_benefit:28,
      positive_day_percent:100,no_action_day_percent:0,uncertainty_robust_day_percent:100});
    expect(result).toMatchObject({evidence_status:'LIMITED_MULTI_DAY_EVIDENCE',leader_stability:'SIZING_LEADER_UNSTABLE_ACROSS_DAYS',
      unique_months:2,weekday_days:2,weekend_days:1});
    expect(result.candidates.find(item=>item.capacity_kwh===500&&item.power_kw===500)?.pareto_status).toBe('MULTI_DAY_DOMINATED');
    expect(result.marginal_values.some(item=>item.dimension==='CAPACITY'&&item.fixed_value===250)).toBe(true);
    expect(result.marginal_values.some(item=>item.dimension==='POWER'&&item.fixed_value===500)).toBe(true);
  });
  it('classifies insufficient and available evidence at the documented gates',()=>{
    expect(aggregateMultiDaySizing([day('2026-01-01',[1,2,1])])?.evidence_status).toBe('INSUFFICIENT_MULTI_DAY_EVIDENCE');
    const seven=Array.from({length:7},(_,index)=>day(`2026-01-0${index+1}`,[1,2,1]));
    expect(aggregateMultiDaySizing(seven)?.evidence_status).toBe('MULTI_DAY_SCREEN_AVAILABLE');
    expect(aggregateMultiDaySizing(seven)?.leader_stability).toBe('SIZING_LEADER_STABLE_ACROSS_ANALYZED_DAYS');
  });
  it('processes unique dates sequentially and retains per-day failures',async()=>{
    const order:string[]=[];const outcome=await runSequentialSizing(['2026-01-02','2026-01-01','2026-01-01'],async date=>{order.push(date);if(date.endsWith('02'))throw new Error('DAY_FAILED');return date;},()=>false);
    expect(order).toEqual(['2026-01-01','2026-01-02']);expect(outcome.completed).toHaveLength(1);expect(outcome.failures).toEqual([{date:'2026-01-02',error:'DAY_FAILED'}]);
  });
  it('stops after cancellation while preserving completed results and caps requests at 31 dates',async()=>{
    let stop=false;const run=vi.fn(async(date:string)=>{stop=true;return date});const outcome=await runSequentialSizing(['2026-01-01','2026-01-02'],run,()=>stop);
    expect(outcome.cancelled).toBe(true);expect(outcome.completed).toHaveLength(1);expect(run).toHaveBeenCalledTimes(1);
    await expect(runSequentialSizing(Array.from({length:32},(_,i)=>`2026-02-${String(i+1).padStart(2,'0')}`),async()=>1,()=>false)).rejects.toThrow('MAXIMUM_31_HISTORICAL_DAYS');
  });
  it('contains required safety labels without investment calculations',()=>{const source=fs.readFileSync('src/features/bess/MultiDayBessSizingPanel.tsx','utf8');
    expect(source).toContain('NOT AN INVESTMENT RECOMMENDATION');expect(source).toContain('NOT ANNUALIZED');expect(source).toContain('NOT LANDED ELECTRICITY COST');
    expect(source).not.toMatch(/payback|\bROI\b|\bNPV\b|\bIRR\b/i);});
});
