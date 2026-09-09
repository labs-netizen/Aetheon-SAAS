import { describe,it,expect,vi,afterEach } from 'vitest';
import { validDate, validIntervals, validBessDispatch, validDSM, DSM_MODEL } from '@/lib/analytics/domain-safety';
import { sourceApplies, applicableObligations, resolveApplicableRegulatoryParameters } from '@/features/compliance/regulatoryResolver';
import { dsmIncidents } from '@/lib/analytics/dsm-evidence';

const { tables } = vi.hoisted(()=>({ tables:{} as Record<string,any[]> }));
vi.mock('@/lib/supabase/admin',()=>({ createAdminClient:()=>({ from:(table:string)=> {
  const q:any = { then:(resolve:any)=>Promise.resolve({ data:tables[table] || [],error:null }).then(resolve) };
  for (const method of ['select','eq','lte','or']) q[method]=()=>q;
  return q;
} }) }));
const date='2026-09-07';
const params={state:'Maharashtra',discom:'MSEDCL',voltageCategory:'33kV',operatingDate:date};
const source={id:'source',jurisdiction:'Maharashtra',state:'Maharashtra',discom:'MSEDCL',source_url:'https://example.test/order',
  version:'v1',status:'APPROVED',document_date:'2026-01-01',effective_date:'2026-01-01',expiry_date:null,
  approved_by:'reviewer',approved_at:'2026-01-02T00:00:00Z',is_demo:false};
const asset={isDemo:true,batteryId:'battery',siteId:'site',operatingDate:date,usableCapacityKwh:1000,powerRatingKw:100,
  initialSocPct:50,minSocPct:10,maxSocPct:90,chargeEfficiency:0.8,dischargeEfficiency:0.75,degradationCostPerCycleInr:100,
  pricesInrPerMwh:[1000,...Array(95).fill(10000)]};
function dispatch() {
  return {battery_id:'battery',site_id:'site',operating_date:date,solver_version:'BESS_AC_HEURISTIC_DEMO_v2.0',
    power_basis:'AC_GRID_KW',terminal_soc_policy:'RETURN_TO_INITIAL_SOC',is_feasibility_verified:true,
    cycles_equivalent:0.02,gross_arbitrage_value_inr:125,estimated_degradation_cost_inr:2,net_opportunity_value_inr:123,
    blocks:Array.from({length:96},(_,i)=>({block_index:i+1,recommended_action:i===0?'CHARGE':i===1?'DISCHARGE':'IDLE',
      power_kw:i===0?100:i===1?60:0,resulting_soc_pct:i===0?52:50,marginal_cost_inr:i===0?25:0,marginal_revenue_inr:i===1?150:0}))};
}
function regulatoryRows() {
  const row={state:params.state,discom:params.discom,voltage_category:params.voltageCategory,effective_from:'2026-01-01',effective_until:null,is_demo:false};
  tables.open_access_charges=[{...row,id:'charge',regulatory_source_id:'oa',regulatory_sources:{...source,id:'oa',regulatory_domain:'OPEN_ACCESS'},
    cross_subsidy_surcharge_inr_per_kwh:1,additional_surcharge_inr_per_kwh:1,wheeling_charge_inr_per_kwh:1,transmission_charge_inr_per_kwh:1,banking_charge_pct:5}];
  tables.discom_tariffs=[{...row,id:'tariff',regulatory_source_id:'tariff',regulatory_sources:{...source,id:'tariff',regulatory_domain:'TARIFF'},
    energy_charge_normal_inr_per_kwh:7,fixed_charge_inr_per_kva_month:100}];
}
afterEach(()=>{for(const k of Object.keys(tables)) delete tables[k];});

describe('Pass 2 numerical publication validation',()=>{
  it('rejects impossible calendar dates',()=>expect(validDate('2026-02-31')).toBe(false));
  it.each(['timestamp','duplicate','future','missing','negative'])('rejects %s interval evidence',kind=>{
    const rows=Array.from({length:96},(_,i)=>({block_index:i+1,operating_date:date,
      timestamp_utc:new Date(Date.parse(`${date}T00:00:00+05:30`)+i*900000).toISOString(),scheduled_drawal_kw:1000,actual_drawal_kw:1000 as any}));
    const now=Date.parse('2026-09-08T00:00:00+05:30');
    expect(validIntervals(rows,date,['scheduled_drawal_kw','actual_drawal_kw'],now)).toBe(true);
    if(kind==='timestamp') rows[0].timestamp_utc=`${date}T00:00:00Z`;
    if(kind==='duplicate') rows[1].block_index=1;
    if(kind==='missing') rows[1].actual_drawal_kw=null;
    if(kind==='negative') rows[1].actual_drawal_kw=-1;
    expect(validIntervals(rows,date,['scheduled_drawal_kw','actual_drawal_kw'],kind==='future'?now-900001:now)).toBe(false);
  });
  it('independently verifies AC-side efficiency and profit after degradation',()=>expect(validBessDispatch(dispatch(),asset)).toBe(true));
  it.each(['soc','power','dual','profit','terminal','identity','feasibility','blocks','date'])('rejects forged BESS %s',kind=>{
    const r:any=dispatch();
    if(kind==='soc') r.blocks[1].resulting_soc_pct=51;
    if(kind==='power') r.blocks[0].power_kw=101;
    if(kind==='dual') r.blocks[1].charge_power_kw=1;
    if(kind==='profit') r.net_opportunity_value_inr=999;
    if(kind==='terminal') r.blocks[95]={...r.blocks[0],block_index:96};
    if(kind==='identity') r.battery_id='other';
    if(kind==='date') r.operating_date='2026-09-08';
    if(kind==='feasibility') r.is_feasibility_verified=false;
    if(kind==='blocks') r.blocks[95].block_index=95;
    expect(validBessDispatch(r,asset)).toBe(false);
  });
  it('rejects a zero-schedule NORMAL DSM result and keeps undefined ratios out of incident percentages',()=>{
    const blocks=Array.from({length:96},(_,i)=>({block_index:i+1,scheduled_drawal_kw:0,actual_drawal_kw:100,
      deviation_kw:100,deviation_pct:null,risk_level:'CRITICAL',estimated_penalty_inr:null}));
    const r={site_id:'site',operating_date:date,model_version:DSM_MODEL,status:'COMPLETED',blocks,total_deviation_kwh:2400,
      max_positive_deviation_kw:100,max_negative_deviation_kw:0,blocks_in_watch:0,blocks_in_high:0,blocks_in_critical:96};
    expect(validDSM(r,'site',date,Array(96).fill(0),Array(96).fill(100))).toBe(true);
    expect(dsmIncidents(blocks,false)[0]).toMatchObject({severity:'CRITICAL',max_deviation_pct:null,estimated_exposure_inr:null});
    blocks[0].risk_level='NORMAL';
    expect(validDSM(r,'site',date,Array(96).fill(0),Array(96).fill(100))).toBe(false);
  });
});

describe('Pass 2 regulatory authority',()=>{
  it.each([{status:'REVIEW_PENDING'},{status:'SUPERSEDED'},{approved_by:null},{approved_at:null},{is_demo:true},
    {effective_date:'2026-09-08'},{expiry_date:'2026-09-06'},{state:'Gujarat'},{discom:'OTHER'},{version:''},{source_url:null}])
  ('rejects insufficient source authority %j',override=>expect(sourceApplies({...source,...override},params)).toBe(false));
  it('resolves only linked applicable sources',async()=>{
    regulatoryRows();const r=await resolveApplicableRegulatoryParameters(params);
    expect(r.status).toBe('RESOLVED');expect(r.approvedSources.map(s=>s.id)).toEqual(['oa','tariff']);
  });
  it('rejects an overlapping version introduced inside a report period',async()=>{
    regulatoryRows();tables.discom_tariffs.push({...tables.discom_tariffs[0],id:'new',effective_from:'2026-09-08'});
    expect((await resolveApplicableRegulatoryParameters({...params,throughDate:'2026-09-09'})).status).toBe('DATA_GAP');
  });
  it('rejects source expiry and voltage mismatch despite child approval',async()=>{
    regulatoryRows();tables.discom_tariffs[0].regulatory_sources.expiry_date='2026-09-06';
    expect((await resolveApplicableRegulatoryParameters(params)).status).toBe('DATA_GAP');
    regulatoryRows();tables.discom_tariffs[0].voltage_category='11kV';
    expect((await resolveApplicableRegulatoryParameters(params)).status).toBe('DATA_GAP');
  });
  it('removes draft, unbound, wrong-discom and expired obligations',async()=>{
    regulatoryRows();const r=await resolveApplicableRegulatoryParameters(params);
    const obligation={regulatory_source_id:'oa',state:'Maharashtra',discom:'MSEDCL',is_demo:false,status:'PENDING',deadline_date:'2026-09-08'};
    expect(applicableObligations([obligation,{...obligation,regulatory_source_id:'draft'},{...obligation,discom:'OTHER'},
      {...obligation,regulatory_source_id:null},{...obligation,status:'EXPIRED'}],r,params)).toEqual([obligation]);
  });
});
