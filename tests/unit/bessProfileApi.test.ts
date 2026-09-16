import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), rpc: vi.fn(), stored: null as Record<string, unknown> | null }));
vi.mock('@/lib/auth/api-guard', () => ({ authorizeApiRequest: mocks.authorize }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));

import { GET, PATCH } from '@/app/api/bess/profile/route';

const siteId='b4233eac-4f81-4bd2-bab7-8f4e1b1314ab';
const tenantClient={from:(table:string)=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:table==='site_bess_simulation_profiles'?mocks.stored:null,error:null})})})})} as any;
const auth={authorized:true as const,user:{id:'user-1'},organisationId:'org-1',siteId,role:'ORGANISATION_ADMIN',isDemo:false,authenticatedClient:tenantClient};
const productionProfile={capacity_kwh:2000,max_charge_power_kw:500,max_discharge_power_kw:500,min_soc_percent:20,
  max_soc_percent:90,initial_soc_percent:48,charge_efficiency_percent:95,discharge_efficiency_percent:95,
  maximum_daily_throughput_kwh:2000,degradation_cost_rs_per_kwh_throughput:0.5,
  final_soc_requirement:'RETURN_TO_INITIAL_SOC',minimum_final_soc_percent:null,available_blocks:null};
const patchRequest=(profile:Record<string,unknown>=productionProfile)=>new NextRequest('http://localhost/api/bess/profile',{method:'PATCH',
  headers:{Authorization:'Bearer valid-token','Content-Type':'application/json'},body:JSON.stringify({site_id:siteId,profile})});
const getRequest=()=>new NextRequest(`http://localhost/api/bess/profile?site_id=${siteId}`,{headers:{Authorization:'Bearer valid-token'}});

describe('BESS profile API',()=>{
  beforeEach(()=>{
    vi.clearAllMocks();mocks.stored=null;mocks.authorize.mockResolvedValue(auth);
    mocks.rpc.mockImplementation(async(name:string,args:any)=>{
      expect(name).toBe('upsert_site_bess_simulation_profile');
      mocks.stored={...args.p_profile,site_id:args.p_site_id,organisation_id:args.p_organisation_id,is_active:true};
      return{data:mocks.stored,error:null};
    });
  });

  it('saves the exact production-shaped payload and normalizes RPC arguments',async()=>{
    const response=await PATCH(patchRequest());expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('upsert_site_bess_simulation_profile',expect.objectContaining({
      p_actor_id:'user-1',p_actor_role:'ORGANISATION_ADMIN',p_organisation_id:'org-1',p_site_id:siteId,
      p_profile:expect.objectContaining({nameplate_energy_capacity_kwh:2000,minimum_soc_percent:20,maximum_soc_percent:90,
        initial_soc_percent:48,final_soc_requirement:'RETURN_TO_INITIAL_SOC',final_soc_percent:null,available_blocks:null}),
    }));
  });

  it('reads the saved values back through the authenticated RLS client',async()=>{
    await PATCH(patchRequest());const response=await GET(getRequest());expect(response.status).toBe(200);
    const body=await response.json();expect(body.profile).toMatchObject({nameplate_energy_capacity_kwh:2000,
      max_charge_power_kw:500,max_discharge_power_kw:500,initial_soc_percent:48,final_soc_percent:null,available_blocks:null});
  });

  it('updates the existing site-scoped profile',async()=>{
    await PATCH(patchRequest());const response=await PATCH(patchRequest({...productionProfile,initial_soc_percent:55}));
    expect(response.status).toBe(200);expect(mocks.stored).toMatchObject({initial_soc_percent:55,site_id:siteId,organisation_id:'org-1'});
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it('returns a 4xx validation result without calling the RPC',async()=>{
    const response=await PATCH(patchRequest({...productionProfile,initial_soc_percent:95}));
    expect(response.status).toBe(422);expect(await response.json()).toEqual({error:'BESS_PROFILE_VALIDATION_FAILED'});
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('denies cross-tenant writes before the privileged RPC',async()=>{
    mocks.authorize.mockResolvedValue({authorized:false,response:NextResponse.json({error:'SITE_ACCESS_DENIED'},{status:403})});
    const response=await PATCH(patchRequest());expect(response.status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('denies an invalid bearer before the privileged RPC',async()=>{
    mocks.authorize.mockResolvedValue({authorized:false,response:NextResponse.json({error:'INVALID_BEARER_TOKEN'},{status:401})});
    const response=await PATCH(patchRequest());expect(response.status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('maps database denial and internal RPC failure without exposing database details',async()=>{
    const consoleError=vi.spyOn(console,'error').mockImplementation(()=>{});
    mocks.rpc.mockResolvedValueOnce({data:null,error:{code:'42501',message:'permission denied for table memberships',details:null,hint:null}});
    let response=await PATCH(patchRequest());expect(response.status).toBe(403);expect(await response.json()).toEqual({error:'BESS_PROFILE_WRITE_DENIED'});
    mocks.rpc.mockResolvedValueOnce({data:null,error:{code:'22023',message:'cannot extract elements from a scalar',details:null,hint:null}});
    response=await PATCH(patchRequest());expect(response.status).toBe(500);expect(await response.json()).toEqual({error:'BESS_PROFILE_RPC_FAILED'});
    expect(consoleError).toHaveBeenCalledTimes(2);consoleError.mockRestore();
  });

  it('corrects migration 032 JSON-null handling without opening authenticated writes',()=>{
    const original=readFileSync('supabase/migrations/20260916000032_site_bess_simulation_profiles.sql','utf8');
    const correction=readFileSync('supabase/migrations/20260916000033_bess_profile_nullable_available_blocks.sql','utf8');
    expect(original).toContain("CASE WHEN p_profile->'available_blocks' IS NULL");
    expect(correction).toContain("p_profile->'available_blocks' = 'null'::jsonb");
    expect(correction).toContain('SECURITY DEFINER');expect(correction).toContain('SET search_path = pg_catalog, public, pg_temp');
    expect(correction).toContain('GRANT EXECUTE ON FUNCTION public.upsert_site_bess_simulation_profile');
    expect(correction).not.toMatch(/GRANT (INSERT|UPDATE|DELETE).*authenticated/i);
  });
});
