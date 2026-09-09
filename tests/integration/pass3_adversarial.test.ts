import { beforeAll,afterEach,describe,it,expect,vi } from 'vitest';
import { createClient,type SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { PATCH as sitePatch } from '@/app/api/sites/[id]/route';
import { POST as ingest } from '@/app/api/ingestion/commit/route';
import { GET as gridGet,POST as gridPost } from '@/app/api/forecast/route';
import { GET as dsmGet,POST as dsmPost } from '@/app/api/dsm/route';
import { GET as bessGet,POST as bessPost } from '@/app/api/bess/route';
import { GET as reportsGet } from '@/app/api/reports/route';
import { POST as reportPost } from '@/app/api/reports/generate/route';
import { GET as download } from '@/app/api/reports/[id]/download/route';
import { GET as alertsGet } from '@/app/api/alerts/route';
import { POST as acknowledge } from '@/app/api/alerts/[id]/acknowledge/route';
import { POST as checkout } from '@/app/api/billing/checkout/route';
import { POST as cancel } from '@/app/api/billing/cancel/route';
import { POST as invite } from '@/app/api/invitations/send/route';
import { GET as auditGet } from '@/app/api/admin/audit/route';
import { GET as renewablesGet,POST as renewablesPost } from '@/app/api/renewables/route';
import { POST as webhook } from '@/app/api/webhooks/razorpay/route';
import { billingProvider } from '@/features/billing/razorpayAdapter';
import { DSM_MODEL } from '@/lib/analytics/domain-safety';
import * as analytics from '@/lib/analytics/client';

const stamp=crypto.randomUUID(),date='2026-08-15';
function sql(input:string) {return execFileSync('docker',['exec','-i','supabase_db_Aetheon-SAAS','psql','-U','postgres','-d','postgres','-Atq','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8'}).trim();}
async function must(q:any):Promise<any>{const {data,error}=await q;if(error)throw new Error(error.message);return data;}
function csv(day=date) {return 'operating_date,block_index,start_time,end_time,load_kw\n'+Array.from({length:96},(_,i)=>{
  const t=(n:number)=>`${String(Math.floor(n/4)).padStart(2,'0')}:${String(n%4*15).padStart(2,'0')}`;
  return `${day},${i+1},${t(i)},${t(i+1)},1000`;
}).join('\n');}

describe('Pass 3 adversarial boundaries',()=>{
  let db:SupabaseClient,org:string,otherOrg:string,site:string,hidden:string,foreign:string;
  let owner:any,manager:any,analyst:any,foreignAlert:string,hiddenAlert:string,report:string,subscription:string;
  function req(path:string,token:string,body?:any,method='POST') {return new NextRequest(`http://localhost${path}`,{
    method:body===undefined?'GET':method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});}
  async function user(label:string) {
    const email=`pass3-${label}-${stamp}@example.com`,password='Pass3-Strong-Password!123';
    const u=await must(db.auth.admin.createUser({email,password,email_confirm:true}));
    const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false,storageKey:`pass3-${label}`}});
    const session=await must(client.auth.signInWithPassword({email,password}));return{id:u.user.id,token:session.session.access_token,client};
  }
  async function createSite(o:string,name:string) {return (await must(db.from('sites').insert({organisation_id:o,name,state:'Maharashtra',discom:'MSEDCL',voltage_category:'33kV',
    contract_demand_value:1000,contract_demand_unit:'kVA',metering_point:'Main incomer',is_demo:false}).select().single())).id;}
  async function alert(o:string,s:string) {return(await must(db.from('alerts').insert({organisation_id:o,site_id:s,module:'DSM',alert_type:'DEVIATION',severity:'HIGH',
    title:'Pass3 alert',description:'Test condition',fingerprint:crypto.randomUUID(),status:'ACTIVE'}).select().single())).id;}
  beforeAll(async()=>{
    if (!['127.0.0.1','localhost'].includes(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname)) throw new Error('Local Supabase only');
    db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false,storageKey:'pass3-service'}});
    org=(await must(db.from('organisations').insert({name:`Pass3 ${stamp}`,legal_entity_name:'Pass3 fixture'}).select().single())).id;
    otherOrg=(await must(db.from('organisations').insert({name:`Pass3 other ${stamp}`,legal_entity_name:'Pass3 other'}).select().single())).id;
    owner=await user('owner');manager=await user('manager');analyst=await user('analyst');
    await must(db.from('memberships').insert([{organisation_id:org,user_id:owner.id,role:'ORGANISATION_ADMIN'},
      {organisation_id:org,user_id:manager.id,role:'ENERGY_MANAGER'},
      {organisation_id:org,user_id:analyst.id,role:'AETHEON_ANALYST',expires_at:new Date(Date.now()+3600000).toISOString()}]));
    site=await createSite(org,'Pass3 permitted');hidden=await createSite(org,'Pass3 restricted');foreign=await createSite(otherOrg,'Pass3 foreign');
    await must(db.from('site_access').insert([{user_id:manager.id,site_id:site},{user_id:analyst.id,site_id:site}]));
    await must(db.from('entitlements').insert(['GRID_INTELLIGENCE','DSM_RISK','BESS_ARBITRAGE','OA_COMPLIANCE','RENEWABLE_PORTFOLIO'].map(product_id=>({organisation_id:org,site_id:site,product_id,is_active:true}))));
    foreignAlert=await alert(otherOrg,foreign);hiddenAlert=await alert(org,hidden);
    report=(await must(db.from('report_records').insert({organisation_id:otherOrg,site_id:foreign,module:'RENEWABLE',report_type:'RENEWABLES_RECONCILIATION',
      period_start:date,period_end:date,title:'Foreign report',summary:{csv_content:'FOREIGN_SECRET'},quality_status:'QUALITY_UNKNOWN',model_version:'DEMO'}).select().single())).id;
    subscription=(await must(db.from('subscriptions').insert({organisation_id:otherOrg,status:'ACTIVE',billing_provider:'MOCK',billing_provider_ref:`pass3-${stamp}`,
      current_period_start:new Date().toISOString(),current_period_end:'2090-01-01'}).select().single())).id;
  });
  afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});

  for(const boundary of ['foreign organisation','ungranted site']) {
    it.each(['sites','ingestion','GRID GET','GRID POST','DSM GET','DSM POST','BESS GET','BESS POST','reports list','reports generate','alerts list','alerts acknowledge'])(
      `rejects %s against ${boundary}`,async endpoint=>{
        const target=boundary==='foreign organisation'?foreign:hidden,token=manager.token;
        const body={siteId:target,operatingDate:date,isDemo:true,pricesInrPerMwh:Array(96).fill(9999)};
        let res:Response;
        switch(endpoint){
          case 'sites':res=await sitePatch(req('/api/sites',token,{name:'attack'},'PATCH'),{params:{id:target}});break;
          case 'ingestion':res=await ingest(req('/api/ingestion/commit',token,{siteId:target,csvText:csv(),filename:'attack.csv'}));break;
          case 'GRID GET':res=await gridGet(req(`/api/forecast?siteId=${target}`,token));break;
          case 'GRID POST':res=await gridPost(req('/api/forecast',token,body));break;
          case 'DSM GET':res=await dsmGet(req(`/api/dsm?siteId=${target}`,token));break;
          case 'DSM POST':res=await dsmPost(req('/api/dsm',token,body));break;
          case 'BESS GET':res=await bessGet(req(`/api/bess?siteId=${target}`,token));break;
          case 'BESS POST':res=await bessPost(req('/api/bess',token,body));break;
          case 'reports list':res=await reportsGet(req(`/api/reports?siteId=${target}`,token));break;
          case 'reports generate':res=await reportPost(req('/api/reports/generate',token,{siteId:target,reportType:'GRID_DAILY_BRIEF',periodStart:date}));break;
          case 'alerts list':res=await alertsGet(req(`/api/alerts?siteId=${target}`,token));break;
          default:res=await acknowledge(req('/api/alerts/acknowledge',token,{}),{params:{id:target===foreign?foreignAlert:hiddenAlert}});
        }
        expect(res.status).toBe(403);
    });
  }
  it('rejects foreign report, subscription, checkout, invitation and admin/audit IDs',async()=>{
    expect((await download(req('/api/reports/download',owner.token),{params:{id:report}})).status).toBe(403);
    expect((await cancel(req('/api/billing/cancel',owner.token,{subscriptionId:subscription}))).status).toBe(403);
    expect((await checkout(req('/api/billing/checkout',owner.token,{organisationId:org,siteId:foreign,productId:'DSM_RISK'}))).status).toBe(400);
    expect((await invite(req('/api/invitations/send',owner.token,{organisationId:org,siteId:foreign,email:'pass3@example.com',role:'OPERATOR'}))).status).toBe(400);
    expect((await auditGet(req(`/api/admin/audit?organisationId=${otherOrg}`,owner.token))).status).toBe(403);
  });
  it('does not inherit a different member’s admin storage rights or a global analyst storage exemption',async()=>{
    const paths=[`tenants/${org}/${site}/permitted.csv`,`tenants/${org}/${hidden}/hidden.csv`,`tenants/${otherOrg}/${foreign}/foreign.csv`];
    for(const path of paths) await must(db.storage.from('tenant-uploads').upload(path,'sensitive meter data',{contentType:'text/csv',upsert:true}));
    try {
      expect((await manager.client.storage.from('tenant-uploads').download(paths[0])).error).toBeNull();
      expect((await manager.client.storage.from('tenant-uploads').download(paths[1])).error).not.toBeNull();
      expect((await manager.client.storage.from('tenant-uploads').createSignedUrl(paths[1],60)).error).not.toBeNull();
      expect((await analyst.client.storage.from('tenant-uploads').download(paths[2])).error).not.toBeNull();
      expect((await analyst.client.storage.from('tenant-uploads').createSignedUrl(paths[2],60)).error).not.toBeNull();
    }finally{await db.storage.from('tenant-uploads').remove(paths);}
  });
  it('keeps the immediate audit predecessor when IDs were allocated out of insertion order',()=>{
    expect(sql(`BEGIN;
      CREATE TEMP TABLE allocation AS SELECT nextval('public.audit_logs_id_seq') a,nextval('public.audit_logs_id_seq') b;
      INSERT INTO public.audit_logs(id,organisation_id,action,entity_type,entity_id) SELECT b,'${org}','P3_SECOND','TEST','${stamp}' FROM allocation;
      INSERT INTO public.audit_logs(id,organisation_id,action,entity_type,entity_id) SELECT a,'${org}','P3_FIRST','TEST','${stamp}' FROM allocation;
      INSERT INTO public.audit_logs(organisation_id,action,entity_type,entity_id) VALUES('${org}','P3_THIRD','TEST','${stamp}');
      SELECT a.previous_hash=b.current_hash FROM public.audit_logs a,public.audit_logs b WHERE a.entity_id='${stamp}' AND b.entity_id='${stamp}' AND a.action='P3_THIRD' AND b.action='P3_FIRST';
      ROLLBACK;`)).toBe('t');
  });
  it('concurrent audit writes and alert acknowledgements produce one chain and one acknowledgement audit',async()=>{
    const id=await alert(org,site);
    const results=await Promise.all(Array.from({length:6},()=>acknowledge(req('/api/alerts/acknowledge',manager.token,{}),{params:{id}})));
    expect(results.every(r=>r.status===200)).toBe(true);
    const logs=await must(db.from('audit_logs').select('action').eq('entity_id',id));expect(logs).toHaveLength(1);
    await Promise.all(Array.from({length:12},(_,i)=>must(db.from('audit_logs').insert({organisation_id:org,action:`P3_CONCURRENT_${i}`,entity_type:'TEST'}))));
    expect(sql(`SELECT count(*) FROM (SELECT previous_hash FROM public.audit_logs WHERE organisation_id='${org}' GROUP BY previous_hash HAVING count(*)>1) f;`)).toBe('0');
  });
  it('serializes duplicate raw ingestion without duplicate state or audit',async()=>{
    const responses=await Promise.all([1,2].map(()=>ingest(req('/api/ingestion/commit',owner.token,{siteId:site,csvText:csv(),filename:'pass3.csv'}))));
    expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
    expect(await must(db.from('interval_data_96').select('block_index').eq('site_id',site).eq('operating_date',date))).toHaveLength(96);
    expect(await must(db.from('audit_logs').select('id').eq('site_id',site).eq('action','AMR_INTERVAL_INGESTION_COMMITTED'))).toHaveLength(1);
  });
  it('does not certify future live telemetry as recent publishable evidence',async()=>{
    const res=await ingest(req('/api/ingestion/commit',owner.token,{siteId:site,csvText:csv('2090-01-01'),filename:'future.csv'}));
    expect(res.status).toBe(422);
    expect(await must(db.from('data_quality_evaluations').select('id').eq('site_id',site).eq('evaluation_date','2090-01-01'))).toHaveLength(0);
  });
  it('enforces completed-day and freshness evidence inside the ingestion RPC',async()=>{
    const commit=(day:string)=>db.rpc('commit_ingestion_transaction',{p_site_id:site,p_filename:'rpc.csv',p_checksum_sha256:crypto.createHash('sha256').update(day+stamp).digest('hex'),
      p_uploaded_by:owner.id,p_org_id:org,p_freshness_status:'RECENT',p_actor_role:'PLATFORM_ADMIN',
      p_rows:Array.from({length:96},(_,i)=>({operating_date:day,block_index:i+1,load_kw:1000,solar_generation_kw:0}))});
    expect((await commit('2090-01-02')).error?.message).toContain('INCOMPLETE_OPERATING_DAY');
    expect((await commit('2010-01-01')).error).toBeNull();
    expect(await must(db.from('data_quality_evaluations').select('freshness_status,publication_gate_status').eq('site_id',site).eq('evaluation_date','2010-01-01').single()))
      .toEqual({freshness_status:'STALE',publication_gate_status:'BLOCKED_STALE_DATA'});
  });
  it.each(['unavailable','timeout'])('suppresses DSM publication when analytics is %s',async failure=>{
    await must(db.from('interval_data_96').update({scheduled_drawal_kw:1000,actual_drawal_kw:1000}).eq('site_id',site).eq('operating_date',date));
    vi.spyOn(analytics,'fetchDSMCalculation').mockRejectedValueOnce(new Error(failure==='timeout'?'AbortError: timeout':'connection refused'));
    const res=await dsmPost(req('/api/dsm',owner.token,{siteId:site,operatingDate:date,isDemo:true}));
    expect(res.status).toBe(502);
    expect(await must(db.from('dsm_evaluation_runs').select('id').eq('site_id',site))).toHaveLength(0);
  });
  it('serializes concurrent identical DSM evaluations into one snapshot and one incident window',async()=>{
    await must(db.from('interval_data_96').update({scheduled_drawal_kw:1000,actual_drawal_kw:1200}).eq('site_id',site).eq('operating_date',date));
    vi.spyOn(analytics,'fetchDSMCalculation').mockImplementation(async(p:any)=>({site_id:p.siteId,operating_date:p.operatingDate,
      model_version:DSM_MODEL,status:'COMPLETED',blocks:Array.from({length:96},(_,i)=>({block_index:i+1,scheduled_drawal_kw:1000,actual_drawal_kw:1200,
        deviation_kw:200,deviation_pct:20,risk_level:'CRITICAL',estimated_penalty_inr:99999})),total_deviation_kwh:4800,
      max_positive_deviation_kw:200,max_negative_deviation_kw:0,blocks_in_watch:0,blocks_in_high:0,blocks_in_critical:96,estimated_total_exposure_inr:99999}) as any);
    const responses=await Promise.all(Array.from({length:4},()=>dsmPost(req('/api/dsm',owner.token,{siteId:site,operatingDate:date,isDemo:true}))));
    expect(responses.map(r=>r.status)).toEqual([200,200,200,200]);
    for(const res of responses)expect(await res.json()).toMatchObject({persisted:true,estimated_total_exposure_inr:null,rule_version:null});
    expect(await must(db.from('dsm_evaluation_runs').select('id').eq('site_id',site).eq('operating_date',date))).toHaveLength(1);
    expect(await must(db.from('dsm_incidents').select('start_block,end_block,estimated_exposure_inr').eq('site_id',site).eq('operating_date',date)))
      .toEqual([{start_block:1,end_block:96,estimated_exposure_inr:null}]);
  });
  it('deduplicates concurrent signed payments while serializing a shared entitlement and subscription cancellation',async()=>{
    const billingSite=await createSite(org,'Pass3 billing concurrency');
    const checkouts=await must(db.from('billing_checkout_sessions').insert(Array.from({length:3},()=>({organisation_id:org,site_id:billingSite,product_id:'DSM_RISK',
      provider_reference:`order_${crypto.randomUUID().replaceAll('-','')}`,amount_paise:2490000,provider_mode:'RAZORPAY_LIVE'}))).select());
    const secret='pass3-test-signature-secret';vi.stubEnv('RAZORPAY_WEBHOOK_SECRET',secret);
    const bodies=checkouts.map((c:any)=>JSON.stringify({event:'payment.captured',payload:{payment:{entity:{id:`pay_${crypto.randomUUID().replaceAll('-','')}`,
      order_id:c.provider_reference,amount:c.amount_paise,currency:'INR',status:'captured',captured:true,notes:{org_id:otherOrg,site_id:foreign}}}}}));
    const send=(body:string)=>webhook(new NextRequest('http://localhost/api/webhooks/razorpay',{method:'POST',body,headers:{
      'x-razorpay-event-id':crypto.randomUUID(),'x-razorpay-signature':crypto.createHmac('sha256',secret).update(body).digest('hex')}}));
    const cancelling=await must(db.from('subscriptions').insert({organisation_id:org,status:'ACTIVE',billing_provider:billingProvider.mode==='MOCK_DEVELOPMENT'?'MOCK':'RAZORPAY',
      billing_provider_ref:`sub_pass3_${stamp}`,current_period_start:new Date().toISOString(),current_period_end:'2090-01-01'}).select().single());
    vi.spyOn(billingProvider,'cancelSubscription').mockResolvedValue({success:true,mode:billingProvider.mode});
    const responses=await Promise.all([...bodies.flatMap((b:string)=>[send(b),send(b)]),
      ...Array.from({length:4},()=>cancel(req('/api/billing/cancel',owner.token,{subscriptionId:cancelling.id})))]);
    expect(responses.map(r=>r.status)).toEqual(Array(10).fill(200));
    const subs=await must(db.from('subscriptions').select('id,current_period_end').in('billing_provider_ref',checkouts.map((c:any)=>c.provider_reference)));
    expect(subs).toHaveLength(3);
    expect(await must(db.from('invoices').select('id').in('subscription_id',subs.map((s:any)=>s.id)))).toHaveLength(3);
    const ent=await must(db.from('entitlements').select('valid_until').eq('organisation_id',org).eq('site_id',billingSite).eq('product_id','DSM_RISK'));
    expect(ent).toHaveLength(1);expect(Date.parse(ent[0].valid_until)).toBe(Math.max(...subs.map((s:any)=>Date.parse(s.current_period_end))));
    expect(await must(db.from('billing_cancellation_requests').select('status').eq('subscription_id',cancelling.id))).toEqual([{status:'COMPLETED'}]);
    expect(await must(db.from('audit_logs').select('id').eq('entity_id',cancelling.id).eq('action','SUBSCRIPTION_CANCELLED'))).toHaveLength(1);
  });
  it('blocks synthetic and unknown-quality renewable exports for live tenants',async()=>{
    await must(db.from('renewable_generation_ledger').insert({site_id:site,operating_date:date,total_measured_generation_kwh:1000,
      total_modelled_generation_kwh:12345,performance_ratio_pct:8,avoided_emissions_tco2e:0.716,emission_factor_source:'CEA_CO2_BASELINE_DB_v19_DEMO',reconciliation_status:'RECONCILED'}));
    const res=await reportPost(req('/api/reports/generate',owner.token,{siteId:site,reportType:'RENEWABLES_RECONCILIATION',periodStart:date,periodEnd:date}));
    expect(res.status).toBe(422);
    const legacy=await must(db.from('report_records').insert({organisation_id:org,site_id:site,module:'RENEWABLE',report_type:'RENEWABLES_RECONCILIATION',
      period_start:date,period_end:date,title:'Unsafe legacy',model_version:'DEMO',quality_status:'QUALITY_UNKNOWN',summary:{csv_content:'SYNTHETIC_EXPORT'}}).select().single());
    expect((await download(req('/api/reports/download',owner.token),{params:{id:legacy.id}})).status).toBe(422);
    expect(await must(owner.client.from('report_records').select('id').eq('id',legacy.id))).toHaveLength(0);
    const path=`tenants/${org}/${site}/unsafe-legacy.csv`;
    await must(db.storage.from('tenant-reports').upload(path,'SYNTHETIC_EXPORT',{contentType:'text/csv'}));
    try {
      expect((await owner.client.storage.from('tenant-reports').createSignedUrl(path,60)).error).not.toBeNull();
      expect((await owner.client.storage.from('tenant-reports').download(path)).error).not.toBeNull();
    }finally{await db.storage.from('tenant-reports').remove([path]);}
  });
  it('does not return a cached synthetic renewable ledger as live operational output',async()=>{
    await must(db.from('renewable_generation_ledger').upsert({site_id:site,operating_date:date,total_measured_generation_kwh:1000,
      total_modelled_generation_kwh:12345,performance_ratio_pct:8,avoided_emissions_tco2e:0.716,emission_factor_source:'CEA_DEMO',reconciliation_status:'RECONCILED'},
      {onConflict:'site_id,operating_date'}));
    const res=await renewablesGet(req(`/api/renewables?siteId=${site}&operatingDate=${date}`,owner.token));
    expect(await res.json()).toMatchObject({ledger:null,is_suppressed:true});
    expect(await must(owner.client.from('renewable_generation_ledger').select('*').eq('site_id',site).eq('operating_date',date))).toHaveLength(0);
  });
  it('does not run or persist an unverified renewable model for live tenants',async()=>{
    // Live intervals exist, but neither browser capacity nor a solver success supplies model authority.
    const solver=vi.spyOn(analytics,'fetchRenewableReconciliation').mockResolvedValue({site_id:site,operating_date:date,
      total_measured_generation_kwh:0,total_modelled_generation_kwh:12345,performance_ratio_pct:0,avoided_emissions_tco2e:99,reconciliation_status:'RECONCILED'} as any);
    const res=await renewablesPost(req('/api/renewables',owner.token,{siteId:site,operatingDate:date,installedCapacityKw:1000,isDemo:true}));
    expect(res.status).toBe(422);expect(solver).not.toHaveBeenCalled();
  });
});
