import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
vi.mock('server-only',()=>({}));
const mocks=vi.hoisted(()=>({authorize:vi.fn(),evidence:vi.fn(),history:vi.fn(),forecast:vi.fn(),valid:vi.fn(),
  profile:vi.fn(),sizing:vi.fn(),from:vi.fn()}));
vi.mock('@/lib/auth/api-guard',()=>({authorizeApiRequest:mocks.authorize}));
vi.mock('@/lib/analytics/grid-input-evidence',()=>({resolveGridInputEvidence:mocks.evidence,loadGridHistoricalInput:mocks.history}));
vi.mock('@/lib/analytics/client',()=>({fetchGridForecast:mocks.forecast}));
vi.mock('@/lib/analytics/domain-safety',()=>({validDate:(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v),operatingToday:()=> '2026-09-16',validGridAnalyticsResponse:mocks.valid}));
vi.mock('@/lib/analytics/bess-simulation',()=>({loadBessProfile:mocks.profile}));
vi.mock('@/lib/analytics/bess-sizing',async(importOriginal)=>({...await importOriginal<any>(),requestBessSizing:mocks.sizing}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>({from:mocks.from})}));
import { POST } from '@/app/api/bess/sizing/route';

const siteId='b4233eac-4f81-4bd2-bab7-8f4e1b1314ab';const tenant={from:vi.fn()} as any;
const authorized={authorized:true as const,organisationId:'org-1',isDemo:false,authenticatedClient:tenant,
  site:{id:siteId,organisation_id:'org-1',contract_demand_value:1500}};
const prices=Array.from({length:96},(_,i)=>({block_index:i+1,mcp_rs_per_mwh:5000,source_reference:'IEX',source_file_hash:'hash',provenance_status:'OFFICIAL_SOURCE_CONFIRMED',verification_status:'VERIFIED'}));
const request=(body:any,token='token')=>new NextRequest('http://localhost/api/bess/sizing',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
const body={site_id:siteId,input_date:'2026-04-30',capacity_candidates_kwh:[500,1000],power_candidates_kw:[250,500]};

describe('BESS historical sizing route',()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.authorize.mockResolvedValue(authorized);mocks.evidence.mockResolvedValue({is_complete:true,quality_status:'PASSED'});
    mocks.history.mockResolvedValue({latest_observed_date:'2026-04-30',latest_observed_complete:true,complete_days:[{operating_date:'2026-04-30'}]});
    mocks.forecast.mockResolvedValue({forecast_available:true,latest_input_date:'2026-04-30',forecast_target_date:'2026-05-01',blocks:Array(96).fill({})});mocks.valid.mockReturnValue(true);
    mocks.profile.mockResolvedValue({site_id:siteId,organisation_id:'org-1'});mocks.sizing.mockResolvedValue({candidate_count:4});
    const chain:any={select:vi.fn(()=>chain),eq:vi.fn(()=>chain),order:vi.fn().mockResolvedValue({data:prices,error:null})};mocks.from.mockReturnValue(chain);});
  it('authorizes once, reuses the bearer client, and screens ephemeral candidates',async()=>{const response=await POST(request(body));expect(response.status).toBe(200);
    expect(mocks.authorize).toHaveBeenCalledWith(expect.anything(),{siteId,productId:'BESS_ARBITRAGE',requireBearer:true});
    expect(mocks.evidence).toHaveBeenCalledWith(tenant,siteId,'2026-04-30');expect(mocks.history).toHaveBeenCalledWith(tenant,siteId,426,'2026-04-30');
    expect(mocks.profile).toHaveBeenCalledWith(tenant,siteId,'org-1');expect(mocks.forecast).toHaveBeenCalledTimes(1);expect(mocks.sizing).toHaveBeenCalledTimes(1);
    expect(mocks.sizing).toHaveBeenCalledWith(expect.objectContaining({capacities:[500,1000],powers:[250,500]}));});
  it('denies foreign sites before loading evidence or profiles',async()=>{mocks.authorize.mockResolvedValue({authorized:false,response:NextResponse.json({error:'SITE_ACCESS_DENIED'},{status:403})});
    expect((await POST(request(body))).status).toBe(403);expect(mocks.evidence).not.toHaveBeenCalled();expect(mocks.profile).not.toHaveBeenCalled();});
  it('requires bearer auth and a bounded valid candidate grid',async()=>{expect((await POST(request(body,''))).status).toBe(401);
    expect((await POST(request({...body,capacity_candidates_kwh:Array.from({length:31},(_,i)=>i+1)}))).status).toBe(400);});
  it('enforces exactly one target date per bounded compute request',async()=>{
    expect((await POST(request({...body,selected_target_dates:['2026-05-01','2026-05-02']}))).status).toBe(400);
    const response=await POST(request({...body,input_date:undefined,target_date:'2026-05-01'}));expect(response.status).toBe(200);
    expect(mocks.history).toHaveBeenLastCalledWith(tenant,siteId,426,'2026-04-30');
  });
  it('fails closed when profile, forecast, or exact-date verified prices are unavailable',async()=>{mocks.profile.mockResolvedValue(null);expect((await POST(request(body))).status).toBe(422);
    mocks.profile.mockResolvedValue({});mocks.from.mockReturnValue({select(){return this},eq(){return this},order:vi.fn().mockResolvedValue({data:prices.slice(1),error:null})});
    expect((await POST(request(body))).status).toBe(422);});
});
