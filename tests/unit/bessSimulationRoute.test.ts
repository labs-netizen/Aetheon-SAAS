import { describe, expect, it, beforeEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  authorize: vi.fn(), history: vi.fn(), forecast: vi.fn(), valid: vi.fn(), simulation: vi.fn(),
  adminFrom: vi.fn(),
}));
vi.mock('@/lib/auth/api-guard', () => ({ authorizeApiRequest: mocks.authorize }));
vi.mock('@/lib/analytics/grid-input-evidence', () => ({ loadGridHistoricalInput: mocks.history }));
vi.mock('@/lib/analytics/client', () => ({ fetchGridForecast: mocks.forecast }));
vi.mock('@/lib/analytics/domain-safety', () => ({ operatingToday: () => '2026-05-01', validGridAnalyticsResponse: mocks.valid }));
vi.mock('@/lib/analytics/bess-simulation', () => ({ runBessSimulation: mocks.simulation }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: mocks.adminFrom }) }));

import { GET } from '@/app/api/bess/simulation/route';

const siteId = 'b4233eac-4f81-4bd2-bab7-8f4e1b1314ab';
const tenantClient = { from: vi.fn() } as any;
const authorized = {
  authorized: true as const,
  user: { id: 'user-1' }, organisationId: 'org-1', siteId, role: 'ORGANISATION_ADMIN', isDemo: false,
  authenticatedClient: tenantClient,
  site: { id: siteId, organisation_id: 'org-1', name: 'Facility', state: 'Maharashtra', discom: 'MSEDCL',
    is_demo: false, contract_demand_value: 1500 },
};
const request = (token = 'valid-token') => new NextRequest(`http://localhost/api/bess/simulation?site_id=${siteId}`,
  { headers: token ? { Authorization: `Bearer ${token}` } : {} });

describe('BESS simulation route authorization and site scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue(authorized);
    mocks.history.mockResolvedValue({ complete_days: [{ operating_date: '2026-04-30', load_kw: Array(96).fill(1000) }],
      latest_observed_complete: true });
    mocks.forecast.mockResolvedValue({ site_id: siteId, operating_date: '2026-05-01', forecast_available: true, blocks: Array(96).fill({}) });
    mocks.valid.mockReturnValue(true);
    mocks.simulation.mockResolvedValue({ status: 'DISPATCH_IDENTIFIED' });
  });

  it('reuses the canonically authorized site and bearer client without another sites query', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(mocks.authorize).toHaveBeenCalledWith(expect.anything(), {
      siteId, productId: 'BESS_ARBITRAGE', requireBearer: true,
    });
    expect(mocks.history).toHaveBeenCalledWith(tenantClient, siteId);
    expect(mocks.simulation).toHaveBeenCalledWith(expect.objectContaining({
      client: tenantClient, siteId, organisationId: 'org-1', historicalReplay: false,
    }));
    expect(mocks.adminFrom).not.toHaveBeenCalledWith('sites');
  });

  it('denies a cross-tenant site before profile or evidence loading', async () => {
    mocks.authorize.mockResolvedValue({ authorized: false, response: NextResponse.json({ error: 'SITE_ACCESS_DENIED' }, { status: 403 }) });
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'SITE_ACCESS_DENIED' });
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it('denies a missing bearer with the public-safe authentication error', async () => {
    const response = await GET(request(''));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'AUTHENTICATED_SESSION_REQUIRED' });
    expect(mocks.authorize).not.toHaveBeenCalled();
  });

  it('returns BESS_PROFILE_REQUIRED after successful site authorization', async () => {
    mocks.simulation.mockResolvedValue({ status: 'SUPPRESSED', suppression_reason: 'BESS_PROFILE_REQUIRED' });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect((await response.json()).simulation).toEqual({ status: 'SUPPRESSED', suppression_reason: 'BESS_PROFILE_REQUIRED' });
    expect(mocks.simulation).toHaveBeenCalledWith(expect.objectContaining({ client: tenantClient }));
  });

  it('does not leak a raw sites permission error', async () => {
    mocks.history.mockRejectedValue(new Error('permission denied for table sites'));
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'BESS_EVIDENCE_ACCESS_DENIED' });
  });
});
