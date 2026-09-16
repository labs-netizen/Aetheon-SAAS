import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { GET, PATCH } from '@/app/api/grid/flexibility-profile/route';

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), admin: vi.fn() }));
vi.mock('@/lib/auth/api-guard', () => ({ authorizeApiRequest: mocks.authorize }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }));
const siteId = 'b4233eac-4f81-4bd2-bab7-8f4e1b1314ab';
const orgId = '129cfc77-f611-4191-9b9c-b248452e5641';
const profile = { site_id: siteId, organisation_id: orgId, flexible_load_kw: 100,
  maximum_shift_energy_kwh_per_day: 25, maximum_upward_shift_kw_per_block: 100,
  maximum_downward_shift_kw_per_block: 100, earliest_shift_block: 1, latest_shift_block: 96,
  maximum_shift_duration_blocks: 1, critical_blocks: [50], energy_conservation_required: true,
  minimum_operating_load_kw: null, maximum_operating_load_kw: null, is_active: true };

describe('site flexibility profile API', () => {
  let stored: typeof profile | null;
  beforeEach(() => {
    stored = profile; vi.clearAllMocks();
    const authenticatedClient = { from: () => ({ select: () => ({ eq: () => ({
      maybeSingle: async () => ({ data: stored, error: null }),
    }) }) }) };
    mocks.authorize.mockResolvedValue({ authorized: true, authenticatedClient, organisationId: orgId,
      user: { id: '62ee8027-25c2-493d-a05d-5b52a57e8b96' }, role: 'ENERGY_MANAGER' });
    mocks.admin.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ data: profile, error: null }) });
  });

  it('reads an own-site profile through the bearer-authenticated context', async () => {
    const response = await GET(new NextRequest(`http://localhost/api/grid/flexibility-profile?site_id=${siteId}`,
      { headers: { Authorization: 'Bearer token' } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ configured: true, profile: { site_id: siteId, organisation_id: orgId } });
    expect(mocks.authorize).toHaveBeenCalledWith(expect.anything(), { siteId, productId: 'GRID_INTELLIGENCE', requireBearer: true });
  });

  it('returns FLEXIBILITY_PROFILE_REQUIRED rather than inferring defaults', async () => {
    stored = null;
    const body = await (await GET(new NextRequest(`http://localhost/api/grid/flexibility-profile?site_id=${siteId}`))).json();
    expect(body).toEqual({ configured: false, profile: null, suppression_reason: 'FLEXIBILITY_PROFILE_REQUIRED' });
  });

  it('allows only authorized operational managers to save a bounded profile through the privileged RPC', async () => {
    const response = await PATCH(new NextRequest('http://localhost/api/grid/flexibility-profile', { method: 'PATCH',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_id: siteId, profile }) }));
    expect(response.status).toBe(200);
    expect(mocks.authorize).toHaveBeenCalledWith(expect.anything(), { siteId, productId: 'GRID_INTELLIGENCE',
      requireBearer: true, requiredRoles: ['ORGANISATION_ADMIN', 'ENERGY_MANAGER'] });
    expect(mocks.admin.mock.results[0].value.rpc).toHaveBeenCalledWith('upsert_site_flexibility_profile',
      expect.objectContaining({ p_site_id: siteId, p_organisation_id: orgId }));
  });

  it('preserves foreign-site/role denial and rejects unsafe values before persistence', async () => {
    mocks.authorize.mockResolvedValueOnce({ authorized: false,
      response: NextResponse.json({ error: 'SITE_ORGANISATION_MISMATCH' }, { status: 403 }) });
    const denied = await PATCH(new NextRequest('http://localhost/api/grid/flexibility-profile', { method: 'PATCH',
      body: JSON.stringify({ site_id: siteId, profile }) }));
    expect(denied.status).toBe(403);
    const invalid = await PATCH(new NextRequest('http://localhost/api/grid/flexibility-profile', { method: 'PATCH',
      body: JSON.stringify({ site_id: siteId, profile: { ...profile, flexible_load_kw: 0 } }) }));
    expect(invalid.status).toBe(400);
  });
});
