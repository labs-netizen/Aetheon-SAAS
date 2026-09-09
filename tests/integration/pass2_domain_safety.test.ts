import { beforeAll,afterEach,describe,it,expect,vi } from 'vitest';
import { createClient,type SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { GET as gridGet,POST as gridPost } from '@/app/api/forecast/route';
import { GET as bessGet,POST as bessPost } from '@/app/api/bess/route';
import { GET as dsmGet,POST as dsmPost,PATCH as dsmPatch } from '@/app/api/dsm/route';
import { POST as reportPost } from '@/app/api/reports/generate/route';
import { GET as reportDownload } from '@/app/api/reports/[id]/download/route';
import { GET as reportList } from '@/app/api/reports/route';
import { GET as complianceGet } from '@/app/api/compliance/route';
import { DSM_MODEL } from '@/lib/analytics/domain-safety';

const analytics = vi.hoisted(()=>({ bad:false,grid:vi.fn(),bess:vi.fn(),dsm:vi.fn() }));
vi.mock('@/lib/analytics/client',()=>({fetchGridForecast:analytics.grid,fetchBESSAdvisory:analytics.bess,fetchDSMCalculation:analytics.dsm}));
async function must(q:any):Promise<any>{const {data,error}=await q;if(error)throw new Error(error.message);return data;}
const date='2026-08-20';
const stamp=crypto.randomUUID();
describe('Pass 2 domain publication and evidence regressions',()=>{
  let db:SupabaseClient,customer:SupabaseClient,token:string,org:string,site:string,actor:string,asset:string,source:string;
  const discom=`PASS2_${stamp}`;
  function request(path:string,body?:any,method='POST') {
    return new NextRequest(`http://localhost:3000${path}`,{method:body===undefined?'GET':method,
      headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  }
  async function intervals(actual=1000){
    return must(db.from('interval_data_96').upsert(Array.from({length:96},(_,i)=>({site_id:site,operating_date:date,block_index:i+1,
      timestamp_utc:new Date(Date.parse(`${date}T00:00:00+05:30`)+i*900000).toISOString(),load_kw:1000,
      scheduled_drawal_kw:1000,actual_drawal_kw:actual,data_quality:'PASSED'})),{onConflict:'site_id,operating_date,block_index'}));
  }
  async function evaluate(){return dsmPost(request('/api/dsm',{siteId:site,operatingDate:date}));}
  async function generate(type='DSM_MONTHLY_REVIEW',end=date){return reportPost(request('/api/reports/generate',{
    siteId:site,reportType:type,periodStart:date,periodEnd:end}));}
  beforeAll(async()=>{
    db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
    const email=`pass2-${stamp}@example.com`,password='Pass2-Secure-Password!123';
    actor=(await must(db.auth.admin.createUser({email,password,email_confirm:true}))).user.id;
    customer=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
    token=(await must(customer.auth.signInWithPassword({email,password}))).session.access_token;
    org=(await must(db.from('organisations').insert({name:`Pass2 ${stamp}`,legal_entity_name:'Pass2 domain fixture'}).select().single())).id;
    await must(db.from('memberships').insert({organisation_id:org,user_id:actor,role:'ORGANISATION_ADMIN'}));
    site=(await must(db.from('sites').insert({organisation_id:org,name:'Pass2 domain fixture',state:'Maharashtra',discom,
      voltage_category:'33kV',contract_demand_value:1000,contract_demand_unit:'kVA',metering_point:'Main incomer',activation_status:'ACTIVE',is_demo:false}).select().single())).id;
    await must(db.from('entitlements').insert(['GRID_INTELLIGENCE','DSM_RISK','BESS_ARBITRAGE','OA_COMPLIANCE'].map(product_id=>({organisation_id:org,site_id:site,product_id,is_active:true}))));
    asset=(await must(db.from('bess_assets').insert({site_id:site,name:'Pass2 battery',usable_capacity_kwh:1000,power_rating_kw:500,
      min_soc_pct:10,max_soc_pct:90,current_soc_pct:50,charge_efficiency:0.9,discharge_efficiency:0.9,
      last_telemetry_at:new Date().toISOString(),is_active:true}).select().single())).id;
    analytics.dsm.mockImplementation(async(p:any)=>{
      if(analytics.bad)return {site_id:p.siteId,operating_date:p.operatingDate,status:'COMPLETED',blocks:[]};
      const blocks=p.actualDrawalKw.map((actual:number,i:number)=>({block_index:i+1,scheduled_drawal_kw:p.scheduledDrawalKw[i],actual_drawal_kw:actual,
        deviation_kw:actual-p.scheduledDrawalKw[i],deviation_pct:(actual-p.scheduledDrawalKw[i])/p.scheduledDrawalKw[i]*100,
        risk_level:actual===1000?'NORMAL':'CRITICAL',estimated_penalty_inr:999999}));
      return {site_id:p.siteId,operating_date:p.operatingDate,model_version:DSM_MODEL,status:'COMPLETED',blocks,
        total_deviation_kwh:blocks.reduce((v:number,b:any)=>v+Math.abs(b.deviation_kw)*0.25,0),
        max_positive_deviation_kw:Math.max(0,...blocks.map((b:any)=>b.deviation_kw)),max_negative_deviation_kw:Math.min(0,...blocks.map((b:any)=>b.deviation_kw)),
        blocks_in_watch:0,blocks_in_high:0,blocks_in_critical:blocks.filter((b:any)=>b.risk_level==='CRITICAL').length,
        estimated_total_exposure_inr:999999,rule_status:'APPROVED',rule_version:'FORGED_FEE'};
    });
  });
  afterEach(()=>{analytics.bad=false;analytics.grid.mockClear();analytics.bess.mockClear();analytics.dsm.mockClear();});

  it('suppresses live GRID POST and cached GET despite PUBLISHABLE quality and browser history',async()=>{
    await must(db.from('data_quality_evaluations').insert({site_id:site,evaluation_date:date,completeness_pct:100,validation_status:'PASSED',freshness_status:'RECENT',publication_gate_status:'PUBLISHABLE'}));
    await must(db.from('grid_forecast_runs').insert({site_id:site,operating_date:date,model_version:'GRID_HEURISTIC_INTERNAL_VALIDATION_v1.0',
      model_generation_time:new Date().toISOString(),average_price_inr_per_mwh:9000,peak_demand_kw:1000,peak_demand_block:1,quality_status:'PUBLISHABLE',freshness_status:'RECENT'}));
    for(const res of [await gridPost(request('/api/forecast',{siteId:site,operatingDate:date,isDemo:true,historicalLoadKw:Array(96).fill(99999)})),
      await gridGet(request(`/api/forecast?siteId=${site}&operatingDate=${date}`))]){
      expect(res.status).toBe(200);expect(await res.json()).toMatchObject({is_suppressed:true,blocks:[],data_quality:'UNVERIFIED'});
    }
    expect(analytics.grid).not.toHaveBeenCalled();
    expect((await generate('GRID_DAILY_BRIEF')).status).toBe(422);
  });
  it('rejects impossible operating dates before invoking a solver',async()=>{
    expect((await gridPost(request('/api/forecast',{siteId:site,operatingDate:'2026-02-31'}))).status).toBe(400);
    expect((await dsmPost(request('/api/dsm',{siteId:site,operatingDate:'2026-02-31'}))).status).toBe(400);
  });
  it('blocks live BESS cached runs, fabricated price provenance and report publication',async()=>{
    await must(db.from('bess_signal_runs').insert({battery_id:asset,operating_date:date,solver_version:'BESS_ARBITRAGE_INTERNAL_VALIDATION_v1.0',
      gross_arbitrage_inr:999,degradation_cost_inr:0,net_opportunity_inr:999,equivalent_cycles:0,is_suppressed:false}));
    const res=await bessPost(request('/api/bess',{siteId:site,operatingDate:date,initialSocPct:-999,pricesInrPerMwh:Array(96).fill(9000)}));
    expect(await res.json()).toMatchObject({is_suppressed:true,persisted:false});
    expect(analytics.bess).not.toHaveBeenCalled();
    expect(await (await bessGet(request(`/api/bess?siteId=${site}&operatingDate=${date}`))).json()).toMatchObject({is_suppressed:true,run:null});
    expect((await generate('BESS_PERFORMANCE_REPORT')).status).toBe(422);
  });
  it('treats future telemetry as invalid, never fresh',async()=>{
    await must(db.from('bess_assets').update({last_telemetry_at:new Date(Date.now()+86400000).toISOString()}).eq('id',asset));
    const data=await(await bessPost(request('/api/bess',{siteId:site,operatingDate:date}))).json();
    expect(data.suppression_reason).toContain('SAFETY_INTERLOCK');expect(analytics.bess).not.toHaveBeenCalled();
  });
  it('rejects UTC-shifted and future DSM intervals even when all 96 rows exist',async()=>{
    await intervals();await must(db.from('interval_data_96').update({timestamp_utc:`${date}T00:00:00Z`}).eq('site_id',site).eq('operating_date',date).eq('block_index',1));
    expect(await(await evaluate()).json()).toMatchObject({is_suppressed:true,persisted:false});expect(analytics.dsm).not.toHaveBeenCalled();
  });
  it('rejects an empty solver success without creating no-incident proof',async()=>{
    await intervals();analytics.bad=true;
    expect(await(await evaluate()).json()).toMatchObject({is_suppressed:true,persisted:false});
    expect(await must(db.from('dsm_evaluation_runs').select('*').eq('site_id',site))).toHaveLength(0);
  });
  it('atomically deduplicates incidents, resets changed acknowledgements, and removes obsolete windows',async()=>{
    await intervals(1200);
    let res=await evaluate();expect(res.status,JSON.stringify(await res.clone().json())).toBe(200);
    let saved=await res.json();expect(saved.estimated_total_exposure_inr).toBeNull();expect(saved.rule_status).toBe('REGULATORY_CONFIGURATION_REQUIRED');
    expect(saved.incidents).toHaveLength(1);expect(saved.incidents[0].estimated_exposure_inr).toBeNull();
    const id=saved.incidents[0].id;
    expect((await dsmPatch(request('/api/dsm',{siteId:site,incidentId:id},'PATCH'))).status).toBe(200);
    saved=await(await evaluate()).json();expect(saved.incidents[0]).toMatchObject({id,acknowledged:true});
    await intervals(1300);saved=await(await evaluate()).json();expect(saved.incidents[0]).toMatchObject({id,acknowledged:false});
    await intervals();saved=await(await evaluate()).json();expect(saved.incidents).toHaveLength(0);
    expect(await must(db.from('dsm_incidents').select('*').eq('site_id',site))).toHaveLength(0);
    expect(await must(db.from('dsm_evaluation_runs').select('*').eq('site_id',site))).toHaveLength(1);
    const audits=await must(db.from('audit_logs').select('id').eq('site_id',site).eq('action','DSM_EVALUATED'));expect(audits.length).toBe(4);
  });
  it('rolls back every incident change when a later insert fails',async()=>{
    const prior=await must(db.from('dsm_evaluation_runs').select('*').eq('site_id',site).single());
    const payload={p_site_id:site,p_org_id:org,p_actor_id:actor,p_date:date,p_input_rows:prior.result_snapshot.input_rows,
      p_input_checksum:prior.input_checksum,p_result:prior.result_snapshot,p_incidents:[
        {start_block:1,end_block:1,severity:'HIGH',max_deviation_pct:10,total_excess_energy_kwh:25,estimated_exposure_inr:null,root_cause_tag:'SCHEDULE_DRIFT'},
        {start_block:2,end_block:2,severity:'INVALID',max_deviation_pct:10,total_excess_energy_kwh:25,estimated_exposure_inr:null,root_cause_tag:'SCHEDULE_DRIFT'}]};
    expect((await db.rpc('commit_dsm_evaluation_atomic',payload)).error).not.toBeNull();
    expect(await must(db.from('dsm_incidents').select('*').eq('site_id',site))).toHaveLength(0);
    expect((await must(db.from('dsm_evaluation_runs').select('*').eq('site_id',site).single())).calculation_timestamp).toBe(prior.calculation_timestamp);
    expect((await customer.rpc('commit_dsm_evaluation_atomic',payload)).error?.code).toBe('42501');
  });
  it('requires every report day and suppresses technical fee claims and stale snapshots',async()=>{
    expect((await generate('DSM_MONTHLY_REVIEW','2026-08-21')).status).toBe(422);
    const res=await generate();expect(res.status,JSON.stringify(await res.clone().json())).toBe(200);
    const report=await res.json();expect(report.summary).toMatchObject({monetaryExposureAuthoritative:false,totalEstimatedExposureInr:null,evaluatedDays:1});
    expect((await reportDownload(request('/api/reports/download'),{params:{id:report.reportId}})).status).toBe(200);
    // Direct storage reads must not bypass the route's current-evidence validation.
    expect((await customer.storage.from('tenant-reports').download(report.storagePath)).error).not.toBeNull();
    await intervals(1200);
    expect(await(await dsmGet(request(`/api/dsm?siteId=${site}&operatingDate=${date}`))).json()).toMatchObject({is_suppressed:true});
    expect((await reportDownload(request('/api/reports/download'),{params:{id:report.reportId}})).status).toBe(422);
    const listed=await(await reportList(request(`/api/reports?siteId=${site}`))).json();expect(listed.reports).toHaveLength(0);
  });
  it('does not return legacy report data through the API or direct report RLS',async()=>{
    const report=await must(db.from('report_records').insert({organisation_id:org,site_id:site,module:'GRID',report_type:'GRID_DAILY_BRIEF',
      title:'Legacy unsafe output',period_start:date,period_end:date,quality_status:'PUBLISHABLE',model_version:'LEGACY',generated_by:actor,
      summary:{csv_content:'unsafe fabricated data'}}).select().single());
    expect((await reportDownload(request('/api/reports/download'),{params:{id:report.id}})).status).toBe(422);
    expect(await must(customer.from('report_records').select('*').eq('id',report.id))).toHaveLength(0);
  });
  it('returns only approved, applicable obligations and binds report versions to their actual sources',async()=>{
    const base={jurisdiction:'Maharashtra',state:'Maharashtra',discom,document_title:'Pass2 authority',source_url:'https://example.test/commission-order',
      document_date:'2026-01-01',effective_date:'2026-01-01',version:'PASS2',status:'APPROVED',approved_by:actor,approved_at:'2026-01-02T00:00:00Z',is_demo:false};
    source=(await must(db.from('regulatory_sources').insert({...base,regulatory_domain:'OPEN_ACCESS'}).select().single())).id;
    const tariffSource=(await must(db.from('regulatory_sources').insert({...base,regulatory_domain:'TARIFF'}).select().single())).id;
    const draft=(await must(db.from('regulatory_sources').insert({...base,status:'REVIEW_PENDING',approved_by:null,approved_at:null}).select().single())).id;
    const child={state:'Maharashtra',discom,voltage_category:'33kV',effective_from:'2026-01-01',is_demo:false};
    await must(db.from('open_access_charges').insert({...child,regulatory_source_id:source,cross_subsidy_surcharge_inr_per_kwh:1,
      additional_surcharge_inr_per_kwh:1,wheeling_charge_inr_per_kwh:1,transmission_charge_inr_per_kwh:1,banking_charge_pct:5}));
    await must(db.from('discom_tariffs').insert({...child,regulatory_source_id:tariffSource,category_name:'HT1',fixed_charge_inr_per_kva_month:100,energy_charge_normal_inr_per_kwh:7}));
    await must(db.from('compliance_obligations').insert([source,draft].map((regulatory_source_id,i)=>({regulatory_source_id,jurisdiction:'Maharashtra',state:'Maharashtra',discom,
      obligation_title:i?'DRAFT_LEAK':'Approved obligation',obligation_type:'FILING',deadline_date:'2026-09-30',status:'PENDING',is_demo:false}))));
    const data=await(await complianceGet(request(`/api/compliance?siteId=${site}&operatingDate=${date}`))).json();
    expect(data.is_data_gap,JSON.stringify(data)).toBe(false);expect(data.calendar).toHaveLength(1);expect(data.calendar[0].obligation_title).toBe('Approved obligation');
    expect(data.sources.map((s:any)=>s.id).sort()).toEqual([source,tariffSource].sort());
    const res=await generate('COMPLIANCE_AUDIT');expect(res.status,JSON.stringify(await res.clone().json())).toBe(200);
    const report=await res.json();
    await must(db.from('regulatory_sources').update({status:'SUPERSEDED'}).eq('id',source));
    expect((await reportDownload(request('/api/reports/download'),{params:{id:report.reportId}})).status).toBe(422);
    expect((await generate('COMPLIANCE_AUDIT')).status).toBe(422);
  });
});
