import type { BESSSizingCandidateContract,BESSSizingResponseContract } from '@/types/analytics-contracts';

export type MultiDayFailure={date:string;error:string};
export type CompletedSizingDay={date:string;result:BESSSizingResponseContract;request_runtime_ms:number};
export type MultiDayPareto='MULTI_DAY_PARETO_EFFICIENT'|'MULTI_DAY_DOMINATED';
export interface AggregatedSizingCandidate {
  capacity_kwh:number;power_kw:number;duration_hours:number;analyzed_days:number;dispatch_days:number;no_action_days:number;
  mean_daily_net_benefit:number;median_daily_net_benefit:number;minimum_daily_net_benefit:number;maximum_daily_net_benefit:number;
  p10_daily_net_benefit:number;p90_daily_net_benefit:number;standard_deviation:number;positive_day_percent:number;
  no_action_day_percent:number;median_efc:number;median_throughput_kwh:number;mean_power_utilization_percent:number;
  mean_usable_energy_utilization_percent:number;uncertainty_robust_day_percent:number;leader_days:number;leader_percent:number;
  pareto_status:MultiDayPareto;daily_net_benefits:Array<{date:string;value:number}>;
}
const mean=(values:number[])=>values.reduce((sum,value)=>sum+value,0)/values.length;
const percentile=(values:number[],fraction:number)=>{const sorted=[...values].sort((a,b)=>a-b);const position=(sorted.length-1)*fraction;
  const low=Math.floor(position),high=Math.ceil(position);return sorted[low]+(sorted[high]-sorted[low])*(position-low);};
const median=(values:number[])=>percentile(values,.5);
const key=(candidate:Pick<BESSSizingCandidateContract,'capacity_kwh'|'power_kw'>)=>`${candidate.capacity_kwh}:${candidate.power_kw}`;

export function aggregateMultiDaySizing(days:CompletedSizingDay[]){
  if(!days.length)return null;
  const winners=new Map<string,number>();const timeline:Array<{date:string;candidate:string}>=[];
  for(const day of days){const winner=[...day.result.candidates].sort((a,b)=>b.net_indicative_benefit_inr-a.net_indicative_benefit_inr||a.capacity_kwh-b.capacity_kwh||a.power_kw-b.power_kw)[0];
    const winnerKey=key(winner);winners.set(winnerKey,(winners.get(winnerKey)||0)+1);timeline.push({date:day.date,candidate:winnerKey});}
  const first=days[0].result.candidates;const candidates:AggregatedSizingCandidate[]=first.map(seed=>{
    const series=days.map(day=>{const candidate=day.result.candidates.find(item=>key(item)===key(seed));if(!candidate)throw new Error('MULTI_DAY_CANDIDATE_GRID_MISMATCH');return {date:day.date,candidate};});
    const net=series.map(item=>item.candidate.net_indicative_benefit_inr);const average=mean(net);
    return {capacity_kwh:seed.capacity_kwh,power_kw:seed.power_kw,duration_hours:seed.duration_hours,analyzed_days:days.length,
      dispatch_days:series.filter(item=>!item.candidate.no_action).length,no_action_days:series.filter(item=>item.candidate.no_action).length,
      mean_daily_net_benefit:average,median_daily_net_benefit:median(net),minimum_daily_net_benefit:Math.min(...net),maximum_daily_net_benefit:Math.max(...net),
      p10_daily_net_benefit:percentile(net,.1),p90_daily_net_benefit:percentile(net,.9),standard_deviation:Math.sqrt(mean(net.map(value=>(value-average)**2))),
      positive_day_percent:100*net.filter(value=>value>0).length/days.length,no_action_day_percent:100*series.filter(item=>item.candidate.no_action).length/days.length,
      median_efc:median(series.map(item=>item.candidate.equivalent_full_cycles)),median_throughput_kwh:median(series.map(item=>item.candidate.throughput_kwh)),
      mean_power_utilization_percent:mean(series.map(item=>Math.max(item.candidate.charge_power_utilization_percent,item.candidate.discharge_power_utilization_percent))),
      mean_usable_energy_utilization_percent:mean(series.map(item=>item.candidate.usable_energy_utilization_percent),),
      uncertainty_robust_day_percent:100*series.filter(item=>item.candidate.uncertainty_status==='ROBUST').length/days.length,
      leader_days:winners.get(key(seed))||0,leader_percent:100*(winners.get(key(seed))||0)/days.length,pareto_status:'MULTI_DAY_PARETO_EFFICIENT',
      daily_net_benefits:series.map(item=>({date:item.date,value:item.candidate.net_indicative_benefit_inr}))};
  });
  for(const candidate of candidates)candidate.pareto_status=candidates.some(other=>other!==candidate&&other.capacity_kwh<=candidate.capacity_kwh&&
    other.power_kw<=candidate.power_kw&&other.median_daily_net_benefit>=candidate.median_daily_net_benefit&&
    (other.capacity_kwh<candidate.capacity_kwh||other.power_kw<candidate.power_kw||other.median_daily_net_benefit>candidate.median_daily_net_benefit))?'MULTI_DAY_DOMINATED':'MULTI_DAY_PARETO_EFFICIENT';
  const sortedDays=days.map(day=>day.date).sort();const months=[...new Set(sortedDays.map(date=>date.slice(0,7)))];
  const weekdayDays=sortedDays.filter(date=>{const day=new Date(`${date}T00:00:00Z`).getUTCDay();return day!==0&&day!==6;}).length;
  const best=[...candidates].sort((a,b)=>b.median_daily_net_benefit-a.median_daily_net_benefit||a.capacity_kwh-b.capacity_kwh||a.power_kw-b.power_kw)[0];
  const stability=winners.size===1?'SIZING_LEADER_STABLE_ACROSS_ANALYZED_DAYS':'SIZING_LEADER_UNSTABLE_ACROSS_DAYS';
  const sufficiency=days.length<3?'INSUFFICIENT_MULTI_DAY_EVIDENCE':days.length<7?'LIMITED_MULTI_DAY_EVIDENCE':'MULTI_DAY_SCREEN_AVAILABLE';
  const marginalValues=[] as Array<{dimension:'CAPACITY'|'POWER';fixed_value:number;from_value:number;to_value:number;delta_median_benefit:number;benefit_per_added_unit:number}>;
  for(const [dimension,fixed,varied] of [['CAPACITY','power_kw','capacity_kwh'],['POWER','capacity_kwh','power_kw']] as const)
    for(const fixedValue of [...new Set(candidates.map(item=>item[fixed]))]){const series=candidates.filter(item=>item[fixed]===fixedValue).sort((a,b)=>a[varied]-b[varied]);
      for(let i=1;i<series.length;i++){const increment=series[i][varied]-series[i-1][varied],delta=series[i].median_daily_net_benefit-series[i-1].median_daily_net_benefit;
        marginalValues.push({dimension,fixed_value:fixedValue,from_value:series[i-1][varied],to_value:series[i][varied],delta_median_benefit:delta,benefit_per_added_unit:delta/increment});}}
  return {analyzed_days:days.length,candidates,best_candidate:best,leader_stability:stability,daily_leaders:timeline,
    evidence_status:sufficiency,first_date:sortedDays[0],last_date:sortedDays.at(-1)!,months,unique_months:months.length,
    weekday_days:weekdayDays,weekend_days:days.length-weekdayDays,marginal_values:marginalValues,
    median_request_runtime_ms:median(days.map(day=>day.request_runtime_ms)),slowest_request_runtime_ms:Math.max(...days.map(day=>day.request_runtime_ms)),
    total_client_runtime_ms:days.reduce((sum,day)=>sum+day.request_runtime_ms,0)};
}

export async function runSequentialSizing<T>(dates:string[],run:(date:string)=>Promise<T>,cancelled:()=>boolean,
  progress?:(state:{current_date:string;completed:number;failed:number})=>void){
  const normalized=[...new Set(dates)].sort();if(normalized.length>31)throw new Error('MAXIMUM_31_HISTORICAL_DAYS');
  const completed:Array<{date:string;value:T;runtime_ms:number}>=[];const failures:MultiDayFailure[]=[];
  for(const date of normalized){if(cancelled())break;const started=performance.now();progress?.({current_date:date,completed:completed.length,failed:failures.length});
    try{completed.push({date,value:await run(date),runtime_ms:performance.now()-started});}catch(error){failures.push({date,error:error instanceof Error?error.message:String(error)});}}
  return {completed,failures,cancelled:cancelled()};
}
