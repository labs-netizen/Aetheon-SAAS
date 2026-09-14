import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { GET as forecastGet } from '@/app/api/forecast/route';
import { resolveGridInputEvidence } from '@/lib/analytics/grid-input-evidence';
import { checkServerEntitlement } from '@/lib/auth/entitlements';

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

    await must(db.from('entitlements').insert([completeSiteId, zeroSiteId, incompleteSiteId].map((siteId) => ({
      organisation_id: orgId, site_id: siteId, product_id: 'GRID_INTELLIGENCE', is_active: true, granted_by: 'INTERNAL_TEST',
    }))));

    const rowsFor = (siteId: string, date: string, count: number) => Array.from({ length: count }, (_, index) => ({
      site_id: siteId,
      operating_date: date,
      block_index: index + 1,
      timestamp_utc: new Date(Date.parse(`${date}T00:00:00+05:30`) + index * 900000).toISOString(),
      load_kw: 900 + index,
      data_quality: 'PASSED',
    }));
    await must(db.from('interval_data_96').insert([
      ...rowsFor(completeSiteId, '2026-01-01', 96),
      ...rowsFor(completeSiteId, '2026-01-02', 96),
      ...rowsFor(incompleteSiteId, '2026-01-03', 91),
    ]));

    const userClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    token = (await must(userClient.auth.signInWithPassword({ email, password }))).session.access_token;
  });

  afterAll(async () => {
    if (db && orgId) await db.from('organisations').delete().eq('id', orgId);
    if (db && foreignOrgId) await db.from('organisations').delete().eq('id', foreignOrgId);
    if (db && userId) await db.auth.admin.deleteUser(userId);
  });

  const request = (siteId: string, operatingDate?: string) => new NextRequest(
    `http://localhost:3000/api/forecast?siteId=${siteId}${operatingDate ? `&operatingDate=${operatingDate}` : ''}`,
    { method: 'GET', headers: { Authorization: `Bearer ${token}` } }
  );

  it('reads a committed own-site day as 96/96 without an organisation mismatch', async () => {
    const response = await forecastGet(request(completeSiteId, '2026-01-01'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ site_id: completeSiteId, organisation_id: orgId, operating_date: '2026-01-01', is_suppressed: true });
    expect(body.input_evidence).toMatchObject({ total_blocks_received: 96, completeness_pct: 100, is_complete: true, source: 'interval_data_96' });
    expect(body.blocks).toHaveLength(0);
    expect(JSON.stringify(body)).not.toContain('SITE_ORGANISATION_MISMATCH');
    expect(await checkServerEntitlement(orgId, completeSiteId, 'GRID_INTELLIGENCE')).toMatchObject({ entitled: true });
  });

  it('resolves the latest committed day and honors an explicitly requested complete day', async () => {
    expect(await resolveGridInputEvidence(db, completeSiteId)).toMatchObject({ operating_date: '2026-01-02', total_blocks_received: 96, is_complete: true });
    expect(await resolveGridInputEvidence(db, completeSiteId, '2026-01-01')).toMatchObject({ operating_date: '2026-01-01', total_blocks_received: 96, is_complete: true });
    const body = await (await forecastGet(request(completeSiteId))).json();
    expect(body.input_evidence).toMatchObject({ operating_date: '2026-01-02', total_blocks_received: 96 });
  });

  it('denies a foreign organisation site', async () => {
    const response = await forecastGet(request(foreignSiteId));
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe('FORBIDDEN_ORGANISATION');
  });

  it('keeps a zero-data site hard-suppressed at 0/96', async () => {
    const response = await forecastGet(request(zeroSiteId));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.input_evidence).toMatchObject({ operating_date: null, total_blocks_received: 0, completeness_pct: 0, is_complete: false });
    expect(body.input_suppression_reason).toContain('INCOMPLETE_INTERVAL_DAY');
    expect(body.suppression_reason).toContain('LIVE_MODEL_AND_PRICE_FEED_REQUIRED');
    expect(body.blocks).toHaveLength(0);
  });

  it('keeps an incomplete operating day hard-suppressed', async () => {
    const response = await forecastGet(request(incompleteSiteId, '2026-01-03'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.input_evidence).toMatchObject({ total_blocks_received: 91, is_complete: false });
    expect(body.input_evidence.completeness_pct).toBeLessThan(95);
    expect(body.input_suppression_reason).toContain('INCOMPLETE_INTERVAL_DAY');
    expect(body.suppression_reason).toContain('LIVE_MODEL_AND_PRICE_FEED_REQUIRED');
    expect(body.blocks).toHaveLength(0);
  });
});
