import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { GET as forecastGet } from '@/app/api/forecast/route';
import { GET as inputEvidenceGet } from '@/app/api/grid/input-evidence/route';
import { resolveGridInputEvidence } from '@/lib/analytics/grid-input-evidence';
import { checkServerEntitlement } from '@/lib/auth/entitlements';
import { resolveSiteForAuthorization } from '@/lib/auth/api-guard';
import { POST as dsmPost } from '@/app/api/dsm/route';

const analytics = vi.hoisted(() => ({
  dsm: vi.fn(async (_input: any) => ({})),
  grid: vi.fn(async (_input: any) => ({})),
}));
vi.mock('@/lib/analytics/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analytics/client')>()),
  fetchDSMCalculation: analytics.dsm,
  fetchGridForecast: analytics.grid,
}));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const stamp = crypto.randomUUID();
async function must(query: any): Promise<any> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

describe('Grid visibility of committed interval data', () => {
  let db: SupabaseClient;
  let userId: string;
  let token: string;
  let orgId: string;
  let foreignOrgId: string;
  let completeSiteId: string;
  let zeroSiteId: string;
  let incompleteSiteId: string;
  let foreignSiteId: string;
  let historySiteId: string;
  let historyLatestDate: string;

  beforeAll(async () => {
    if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Local Supabase only');
    db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    orgId = (await must(db.from('organisations').insert({ name: `Grid visibility ${stamp}`, legal_entity_name: 'Grid fixture' }).select('id').single())).id;
    foreignOrgId = (await must(db.from('organisations').insert({ name: `Grid foreign ${stamp}`, legal_entity_name: 'Foreign fixture' }).select('id').single())).id;
    const email = `grid-visibility-${stamp}@example.com`;
    const password = 'Strong-Test-Password!123';
    const created = await must(db.auth.admin.createUser({ email, password, email_confirm: true }));
    userId = created.user.id;
    await must(db.from('memberships').insert({ organisation_id: orgId, user_id: userId, role: 'ORGANISATION_ADMIN' }));

    const siteFields = { state: 'Maharashtra', discom: 'MSEDCL', voltage_category: '33kV', contract_demand_value: 1000,
      contract_demand_unit: 'kVA', metering_point: 'Main incomer', activation_status: 'ACTIVE', is_demo: false };
    const createSite = async (organisationId: string, name: string) =>
      (await must(db.from('sites').insert({ ...siteFields, organisation_id: organisationId, name }).select('id').single())).id;
    completeSiteId = await createSite(orgId, 'Complete history');
    zeroSiteId = await createSite(orgId, 'Zero history');
    incompleteSiteId = await createSite(orgId, 'Incomplete history');
    foreignSiteId = await createSite(foreignOrgId, 'Foreign history');
    historySiteId = await createSite(orgId, '426-day history');

    await must(db.from('entitlements').insert([completeSiteId, zeroSiteId, incompleteSiteId, historySiteId].map((siteId) => ({
      organisation_id: orgId, site_id: siteId, product_id: 'GRID_INTELLIGENCE', is_active: true, granted_by: 'INTERNAL_TEST',
    }))));
    await must(db.from('entitlements').insert({
      organisation_id: orgId, site_id: completeSiteId, product_id: 'DSM_RISK', is_active: true, granted_by: 'INTERNAL_TEST',
    }));

    const rowsFor = (siteId: string, date: string, count: number) => Array.from({ length: count }, (_, index) => ({
      site_id: siteId,
      operating_date: date,
      block_index: index + 1,
      timestamp_utc: new Date(Date.parse(`${date}T00:00:00+05:30`) + index * 900000).toISOString(),
      load_kw: 900 + index,
      scheduled_drawal_kw: date === '2026-01-01' ? 1000 : 2000,
      actual_drawal_kw: date === '2026-01-01' ? 1100 : 2200,
      data_quality: 'PASSED',
    }));
    await must(db.from('interval_data_96').insert([
      ...rowsFor(completeSiteId, '2026-01-01', 96),
      ...rowsFor(completeSiteId, '2026-01-02', 96),
      ...rowsFor(completeSiteId, '2026-01-03', 91),
      ...rowsFor(incompleteSiteId, '2026-01-03', 91),
    ]));

    const historyRows = Array.from({ length: 426 }, (_, dayIndex) => {
      const operatingDate = new Date(Date.UTC(2024, 0, dayIndex + 1)).toISOString().slice(0, 10);
      return rowsFor(historySiteId, operatingDate, 96);
    }).flat();
    historyLatestDate = historyRows.at(-1)!.operating_date;
    for (let offset = 0; offset < historyRows.length; offset += 2000) {
      await must(db.from('interval_data_96').insert(historyRows.slice(offset, offset + 2000)));
    }

    const userClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    token = (await must(userClient.auth.signInWithPassword({ email, password }))).session.access_token;
  }, 120000);

  afterAll(async () => {
    if (db && orgId) await db.from('organisations').delete().eq('id', orgId);
    if (db && foreignOrgId) await db.from('organisations').delete().eq('id', foreignOrgId);
    if (db && userId) await db.auth.admin.deleteUser(userId);
  });

  const forecastRequest = (siteId: string, operatingDate?: string) => new NextRequest(
    `http://localhost:3000/api/forecast?siteId=${siteId}${operatingDate ? `&operatingDate=${operatingDate}` : ''}`,
    { method: 'GET', headers: { Authorization: `Bearer ${token}` } }
  );
  const evidenceRequest = (siteId: string, operatingDate?: string) => new NextRequest(
    `http://localhost:3000/api/grid/input-evidence?site_id=${siteId}${operatingDate ? `&operating_date=${operatingDate}` : ''}`,
    { method: 'GET', headers: { Authorization: `Bearer ${token}` } }
  );

  it('reads a committed own-site day as 96/96 independently from forecast output', async () => {
    const response = await inputEvidenceGet(evidenceRequest(completeSiteId, '2026-01-01'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      site_id: completeSiteId,
      operating_date: '2026-01-01',
      expected_blocks: 96,
      received_blocks: 96,
      completeness_pct: 100,
      duplicate_blocks: [],
      missing_blocks: [],
      quality_status: 'PASSED',
      data_available: true,
    });
    const forecast = await forecastGet(forecastRequest(completeSiteId, '2026-01-01'));
    expect(forecast.status).toBe(200);
    const forecastBody = await forecast.json();
    expect(forecastBody).toMatchObject({ is_suppressed: true, forecast_available: false, blocks: [] });
    expect(forecastBody).not.toHaveProperty('input_evidence');
    expect(body).toMatchObject({ received_blocks: 96, completeness_pct: 100 });
    expect(await checkServerEntitlement(orgId, completeSiteId, 'GRID_INTELLIGENCE')).toMatchObject({ entitled: true });
  });

  it('keeps previously retrieved evidence independent from a forecast HTTP failure', async () => {
    const evidence = await (await inputEvidenceGet(evidenceRequest(completeSiteId, '2026-01-01'))).json();
    const failedForecast = await forecastGet(forecastRequest(completeSiteId, 'not-a-date'));
    expect(failedForecast.status).toBe(400);
    expect(evidence).toMatchObject({ operating_date: '2026-01-01', received_blocks: 96, completeness_pct: 100 });
  });

  it('requires an explicit bearer token for input evidence', async () => {
    const response = await inputEvidenceGet(new NextRequest(
      `http://localhost:3000/api/grid/input-evidence?site_id=${completeSiteId}`
    ));
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe('AUTHENTICATED_BEARER_REQUIRED');
  });

  it('uses the bearer JWT as authenticated and applies site RLS', async () => {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    expect(claims.role).toBe('authenticated');
    const bearerClient = createClient(url, anonKey, { accessToken: async () => token });
    expect(await must(bearerClient.from('sites').select('id,organisation_id').eq('id', completeSiteId).single()))
      .toEqual({ id: completeSiteId, organisation_id: orgId });
    expect(await must(bearerClient.from('sites').select('id').eq('id', foreignSiteId))).toEqual([]);
    expect((await must(bearerClient.from('interval_data_96').select('block_index').eq('site_id', completeSiteId).eq('operating_date', '2026-01-01')))).toHaveLength(96);
    expect(await must(bearerClient.from('interval_data_96').select('block_index').eq('site_id', foreignSiteId))).toEqual([]);
  });

  it('keeps anonymous and authenticated direct writes blocked', async () => {
    const anonymousClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    expect(await must(anonymousClient.from('interval_data_96').select('block_index').eq('site_id', completeSiteId))).toEqual([]);

    const bearerClient = createClient(url, anonKey, { accessToken: async () => token });
    const unauthorizedRow = {
      site_id: completeSiteId,
      operating_date: '2030-01-01',
      block_index: 1,
      timestamp_utc: '2029-12-31T18:30:00.000Z',
      load_kw: 1,
      data_quality: 'PASSED',
    };
    expect((await bearerClient.from('interval_data_96').insert(unauthorizedRow)).error).toBeTruthy();
    const update = await bearerClient.from('interval_data_96').update({ load_kw: 1 }).eq('site_id', completeSiteId).select('id');
    const deletion = await bearerClient.from('interval_data_96').delete().eq('site_id', completeSiteId).select('id');
    expect(update.error || (update.data || []).length === 0).toBeTruthy();
    expect(deletion.error || (deletion.data || []).length === 0).toBeTruthy();
    const unchanged = await db.from('interval_data_96').select('id', { count: 'exact', head: true })
      .eq('site_id', completeSiteId).eq('operating_date', '2026-01-01');
    expect(unchanged.error).toBeNull();
    expect(unchanged.count).toBe(96);
  });

  it('classifies a PostgreSQL privilege error as lookup failure rather than not-found or RLS denial', async () => {
    const deniedClient = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'permission denied for table sites' } }) }) }) }),
    } as unknown as SupabaseClient;
    expect(await resolveSiteForAuthorization(deniedClient, db, completeSiteId)).toEqual({
      status: 'LOOKUP_FAILED', source: 'authenticated', message: 'permission denied for table sites',
    });
  });

  it('resolves the latest committed day and honors an explicitly requested complete day', async () => {
    expect(await resolveGridInputEvidence(db, completeSiteId)).toMatchObject({ operating_date: '2026-01-02', total_blocks_received: 96, is_complete: true });
    expect(await resolveGridInputEvidence(db, completeSiteId, '2026-01-01')).toMatchObject({ operating_date: '2026-01-01', total_blocks_received: 96, is_complete: true });
    const body = await (await inputEvidenceGet(evidenceRequest(completeSiteId))).json();
    expect(body).toMatchObject({ operating_date: '2026-01-02', received_blocks: 96, completeness_pct: 100 });
  });

  it('selects the latest complete day from a 426-day committed dataset without invoking analytics', async () => {
    analytics.grid.mockClear();
    const response = await inputEvidenceGet(evidenceRequest(historySiteId));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      site_id: historySiteId,
      operating_date: historyLatestDate,
      received_blocks: 96,
      completeness_pct: 100,
      data_available: true,
    });
    expect(analytics.grid).not.toHaveBeenCalled();
  });

  it('gives DSM only the explicitly requested day from multi-day site history', async () => {
    analytics.dsm.mockClear();
    const response = await dsmPost(new NextRequest('http://localhost:3000/api/dsm', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: completeSiteId, operatingDate: '2026-01-01' }),
    }));
    expect(response.status).toBe(200);
    expect(analytics.dsm).toHaveBeenCalledOnce();
    expect(analytics.dsm.mock.calls[0][0]).toMatchObject({
      siteId: completeSiteId,
      operatingDate: '2026-01-01',
      scheduledDrawalKw: Array(96).fill(1000),
      actualDrawalKw: Array(96).fill(1100),
    });
  });

  it('denies a foreign organisation site', async () => {
    const response = await inputEvidenceGet(evidenceRequest(foreignSiteId));
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe('FORBIDDEN_ORGANISATION');
  });

  it('keeps a zero-data site hard-suppressed at 0/96', async () => {
    const response = await inputEvidenceGet(evidenceRequest(zeroSiteId));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ operating_date: null, expected_blocks: 96, received_blocks: 0, completeness_pct: 0, data_available: false });
    expect(body.missing_blocks).toHaveLength(96);
  });

  it('keeps an incomplete operating day hard-suppressed', async () => {
    const response = await inputEvidenceGet(evidenceRequest(incompleteSiteId, '2026-01-03'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ expected_blocks: 96, received_blocks: 91, quality_status: 'FAILED', data_available: true });
    expect(body.completeness_pct).toBeLessThan(95);
    expect(body.missing_blocks).toHaveLength(5);
  });
});
