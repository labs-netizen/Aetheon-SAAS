import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { POST as importPrices } from '@/app/api/admin/market-prices/route';
import { GET as priceEvidence } from '@/app/api/grid/price-evidence/route';
import { getBlockTimes } from '@/lib/dates/blocks96';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const stamp = crypto.randomUUID();
const must = async (query: any) => { const { data, error } = await query; if (error) throw new Error(error.message); return data; };
const officialCsv = (date: string) => ['Date,Time Block,MCP (Rs/MWh)', ...Array.from({ length: 96 }, (_, index) => {
  const time = getBlockTimes(index + 1); return `${date},${time.startTime}-${time.endTime},${4000 + index}`;
})].join('\n');

describe('authoritative IEX DAM market price boundary', () => {
  let db: SupabaseClient;
  let adminId: string;
  let customerId: string;
  let adminToken: string;
  let customerToken: string;
  let orgId: string;
  let foreignOrgId: string;
  let siteId: string;
  let foreignSiteId: string;
  const deliveryDate = new Date(Date.UTC(2090, 0, 1 + (Number.parseInt(stamp.replace(/-/g, '').slice(0, 8), 16) % 365))).toISOString().slice(0, 10);

  beforeAll(async () => {
    db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    orgId = (await must(db.from('organisations').insert({ name: `Price ${stamp}`, legal_entity_name: 'Price fixture' }).select('id').single())).id;
    foreignOrgId = (await must(db.from('organisations').insert({ name: `Price foreign ${stamp}`, legal_entity_name: 'Foreign fixture' }).select('id').single())).id;
    const siteFields = { state: 'Maharashtra', discom: 'MSEDCL', voltage_category: '33kV', contract_demand_value: 1000, contract_demand_unit: 'kVA', metering_point: 'Main', activation_status: 'ACTIVE', is_demo: false };
    siteId = (await must(db.from('sites').insert({ ...siteFields, organisation_id: orgId, name: 'Price site' }).select('id').single())).id;
    foreignSiteId = (await must(db.from('sites').insert({ ...siteFields, organisation_id: foreignOrgId, name: 'Foreign price site' }).select('id').single())).id;
    const password = 'Strong-Test-Password!123';
    const admin = await must(db.auth.admin.createUser({ email: `price-admin-${stamp}@example.com`, password, email_confirm: true }));
    const customer = await must(db.auth.admin.createUser({ email: `price-customer-${stamp}@example.com`, password, email_confirm: true }));
    adminId = admin.user.id; customerId = customer.user.id;
    await must(db.from('user_profiles').update({ is_platform_admin: true }).eq('id', adminId));
    await must(db.from('memberships').insert({ organisation_id: orgId, user_id: customerId, role: 'ORGANISATION_ADMIN' }));
    await must(db.from('entitlements').insert({ organisation_id: orgId, site_id: siteId, product_id: 'GRID_INTELLIGENCE', is_active: true, granted_by: 'INTERNAL_TEST' }));
    const adminAuth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const customerAuth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    adminToken = (await must(adminAuth.auth.signInWithPassword({ email: admin.user.email!, password }))).session.access_token;
    customerToken = (await must(customerAuth.auth.signInWithPassword({ email: customer.user.email!, password }))).session.access_token;
  }, 60000);

  afterAll(async () => {
    if (db) {
      await db.from('market_price_blocks').delete().eq('delivery_date', deliveryDate).eq('exchange', 'IEX').eq('market_product', 'DAM');
      await db.from('market_price_imports').delete().eq('delivery_date_start', deliveryDate).eq('delivery_date_end', deliveryDate);
    }
    if (db && orgId) await db.from('organisations').delete().eq('id', orgId);
    if (db && foreignOrgId) await db.from('organisations').delete().eq('id', foreignOrgId);
    if (db && adminId) await db.auth.admin.deleteUser(adminId);
    if (db && customerId) await db.auth.admin.deleteUser(customerId);
  });

  const importRequest = (token: string) => {
    const bytes = Buffer.from(officialCsv(deliveryDate));
    const values = new Map<string, any>([
      ['file', { name: 'iex-dam.csv', arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }],
      ['source_reference', 'https://www.iexindia.com/market-data/day-ahead-market'],
      ['official_source_confirmed', 'true'],
    ]);
    return { headers: new Headers({ Authorization: `Bearer ${token}` }), formData: async () => ({ get: (name: string) => values.get(name) ?? null }) } as unknown as NextRequest;
  };

  it('allows only privileged imports and rejects checksum replay atomically', async () => {
    expect((await importPrices(importRequest(customerToken))).status).toBe(403);
    const responses = await Promise.all([importPrices(importRequest(adminToken)), importPrices(importRequest(adminToken))]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const imported = responses.find((response) => response.status === 200)!;
    expect(await imported.json()).toMatchObject({ status: 'COMMITTED', total_rows: 96, total_days: 1, provenance_status: 'OFFICIAL_SOURCE_CONFIRMED' });
  });

  it('returns exact-date verified evidence through tenant and entitlement authorization', async () => {
    const req = (site: string, date: string) => new NextRequest(`http://localhost/api/grid/price-evidence?site_id=${site}&delivery_date=${date}`, { headers: { Authorization: `Bearer ${customerToken}` } });
    const response = await priceEvidence(req(siteId, deliveryDate));
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    expect(await response.json()).toMatchObject({ exchange: 'IEX', market_product: 'DAM', delivery_date: deliveryDate, received_blocks: 96, completeness_pct: 100, readiness_status: 'READY', price_available: true });
    const nextDate = new Date(Date.parse(`${deliveryDate}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    expect((await priceEvidence(req(siteId, nextDate))).status).toBe(200);
    expect(await (await priceEvidence(req(siteId, nextDate))).json()).toMatchObject({ readiness_status: 'DATE_MISMATCH', price_available: false, blocks: [] });
    expect((await priceEvidence(req(foreignSiteId, deliveryDate))).status).toBe(403);
  });

  it('keeps raw tables and the commit RPC inaccessible to anon/authenticated roles', async () => {
    const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await anon.from('market_price_blocks').select('*')).error).toBeTruthy();
    const customer = createClient(url, anonKey, { accessToken: async () => customerToken });
    expect((await customer.from('market_price_blocks').select('*')).error).toBeTruthy();
    expect((await customer.rpc('commit_iex_dam_market_prices', { p_actor_id: customerId, p_source_file_name: 'x', p_source_file_hash: 'a'.repeat(64), p_source_reference: 'https://iexindia.com/x', p_published_at: null, p_fetched_at: new Date().toISOString(), p_rows: [] })).error).toBeTruthy();
  });
});
