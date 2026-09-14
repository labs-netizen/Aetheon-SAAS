import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkServerEntitlement } from '@/lib/auth/entitlements';

const PRODUCTS = ['GRID_INTELLIGENCE', 'OA_COMPLIANCE', 'DSM_RISK', 'BESS_ARBITRAGE', 'RENEWABLE_PORTFOLIO'] as const;
const CATALOG_SQL_ROWS = [
  "('GRID_INTELLIGENCE', 'Grid Intelligence Monitor', '96-block price/demand forecast, Daily Grid Brief, and peak cost avoidance.', 1990000, 'MONTHLY', 'INTERNAL_VALIDATION')",
  "('OA_COMPLIANCE', 'Open Access Compliance Sentinel', 'Statutory compliance tracking, DISCOM charge calculation (CSS/AS), and SLDC calendar.', 1490000, 'MONTHLY', 'SPECIALIST_REVIEW_REQUIRED')",
  "('DSM_RISK', 'DSM Risk Monitor', 'Continuous 15-minute deviation tracking and regulatory exposure calculation under CERC rules.', 2990000, 'MONTHLY', 'INTERNAL_VALIDATION')",
  "('BESS_ARBITRAGE', 'BESS Arbitrage Signals', 'Advisory charge/discharge opportunity window recommendations for C&I batteries.', 4990000, 'MONTHLY', 'SPECIALIST_REVIEW_REQUIRED')",
  "('RENEWABLE_PORTFOLIO', 'Renewable Portfolio Monitor', 'Generation reconciliation (measured/modelled/estimated) and carbon avoidance ledger.', 2490000, 'MONTHLY', 'DEMO')",
] as const;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const stamp = crypto.randomUUID();
async function must(query: any): Promise<any> { const { data, error } = await query; if (error) throw new Error(error.message); return data; }

describe('controlled internal all-product entitlement', () => {
  let db: SupabaseClient, userClient: SupabaseClient;
  let userId: string, orgId: string, otherOrgId: string;
  let entitledSiteId: string, sameOrgSiteId: string, otherOrgSiteId: string, paidSiteId: string;

  beforeAll(async () => {
    if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Local Supabase only');
    db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    orgId = (await must(db.from('organisations').insert({ name: `Internal ${stamp}`, legal_entity_name: 'Internal fixture' }).select('id').single())).id;
    otherOrgId = (await must(db.from('organisations').insert({ name: `Other ${stamp}`, legal_entity_name: 'Other fixture' }).select('id').single())).id;
    const created = await must(db.auth.admin.createUser({ email: `internal-${stamp}@example.com`, password: 'Strong-Test-Password!123', email_confirm: true }));
    userId = created.user.id;
    await must(db.from('memberships').insert({ organisation_id: orgId, user_id: userId, role: 'ORGANISATION_ADMIN' }));
    const fields = { state: 'Maharashtra', discom: 'MSEDCL', voltage_category: '33kV', contract_demand_value: 1000, contract_demand_unit: 'kVA', metering_point: 'Main incomer', is_demo: false };
    const site = async (organisation_id: string, name: string) => (await must(db.from('sites').insert({ ...fields, organisation_id, name }).select('id').single())).id;
    entitledSiteId = await site(orgId, 'Entitled'); sameOrgSiteId = await site(orgId, 'Unentitled');
    paidSiteId = await site(orgId, 'Paid'); otherOrgSiteId = await site(otherOrgId, 'Foreign');
    userClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    await must(userClient.auth.signInWithPassword({ email: `internal-${stamp}@example.com`, password: 'Strong-Test-Password!123' }));
  });

  afterAll(async () => {
    if (db && orgId) await db.from('organisations').delete().eq('id', orgId);
    if (db && otherOrgId) await db.from('organisations').delete().eq('id', otherOrgId);
    if (db && userId) await db.auth.admin.deleteUser(userId);
  });

  const allGrant = (siteId: string, source = 'INTERNAL_TEST') => db.rpc('grant_internal_all_product_entitlements', {
    p_org_id: orgId, p_site_id: siteId, p_source: source,
    p_valid_until: new Date(Date.now() + 30 * 86400000).toISOString(), p_reason: 'All-module internal validation',
  });

  it('makes the production migration path independent of seed.sql', () => {
    const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260914000027_generic_internal_product_entitlements.sql'), 'utf8');
    expect(migration).toContain('INSERT INTO public.products');
    expect(migration).toContain('ON CONFLICT (id) DO NOTHING');
    for (const catalogRow of CATALOG_SQL_ROWS) expect(migration).toContain(catalogRow);
    expect(migration.indexOf('INSERT INTO public.products')).toBeLessThan(migration.indexOf('CREATE FUNCTION public.grant_internal_product_entitlement'));
  });

  it('uses the authoritative catalog and unlocks every module for exactly one site', async () => {
    const catalog = await must(db.from('products').select('id').in('id', [...PRODUCTS]));
    expect(catalog.map((p: { id: string }) => p.id).sort()).toEqual([...PRODUCTS].sort());
    expect((await must(allGrant(entitledSiteId))).entitlements).toHaveLength(PRODUCTS.length);
    for (const productId of PRODUCTS) expect(await checkServerEntitlement(orgId, entitledSiteId, productId)).toMatchObject({ entitled: true });
  });

  it('keeps another same-organisation site and a foreign organisation paywalled', async () => {
    for (const productId of PRODUCTS) {
      expect(await checkServerEntitlement(orgId, sameOrgSiteId, productId)).toMatchObject({ entitled: false });
      expect(await checkServerEntitlement(otherOrgId, otherOrgSiteId, productId)).toMatchObject({ entitled: false });
    }
  });

  it('does not unlock inactive or expired internal entitlements', async () => {
    await must(db.from('entitlements').update({ valid_until: new Date(Date.now() - 60000).toISOString() }).eq('organisation_id', orgId).eq('site_id', entitledSiteId));
    for (const productId of PRODUCTS) expect(await checkServerEntitlement(orgId, entitledSiteId, productId)).toMatchObject({ entitled: false });
    await must(db.from('entitlements').update({ is_active: false, valid_until: new Date(Date.now() + 86400000).toISOString() }).eq('organisation_id', orgId).eq('site_id', entitledSiteId));
    for (const productId of PRODUCTS) expect(await checkServerEntitlement(orgId, entitledSiteId, productId)).toMatchObject({ entitled: false });
  });

  it('preserves commercial entitlement fields while granting remaining products', async () => {
    const paidUntil = new Date(Date.now() + 60 * 86400000).toISOString();
    await must(db.from('entitlements').insert({ organisation_id: orgId, site_id: paidSiteId, product_id: 'GRID_INTELLIGENCE',
      is_active: true, valid_from: new Date(Date.now() - 60000).toISOString(), valid_until: paidUntil, granted_by: 'RAZORPAY_WEBHOOK' }));
    const result = await must(allGrant(paidSiteId, 'TRIAL'));
    expect(result.entitlements).toContainEqual(expect.objectContaining({ product_id: 'GRID_INTELLIGENCE', status: 'COMMERCIAL_PRESERVED' }));
    const paid = await must(db.from('entitlements').select('granted_by,valid_until,is_active').eq('organisation_id', orgId).eq('site_id', paidSiteId).eq('product_id', 'GRID_INTELLIGENCE').single());
    expect(paid).toMatchObject({ granted_by: 'RAZORPAY_WEBHOOK', is_active: true });
    expect(new Date(paid.valid_until).getTime()).toBe(new Date(paidUntil).getTime());
  });

  it('fails closed for missing catalog IDs and catalog ambiguity is prevented by the primary key', async () => {
    const missing = await db.rpc('grant_internal_product_entitlement', { p_org_id: orgId, p_site_id: sameOrgSiteId,
      p_product_id: 'MISSING_PRODUCT', p_source: 'INTERNAL_TEST', p_valid_until: new Date(Date.now() + 86400000).toISOString(), p_reason: 'Missing' });
    expect(missing.error?.message).toContain('PRODUCT_CATALOG_ENTRY_NOT_FOUND');
    const duplicate = await db.from('products').insert({ id: 'GRID_INTELLIGENCE', name: 'Duplicate', description: 'Must fail',
      base_price_paise: 1, billing_interval: 'MONTHLY', availability_status: 'AVAILABLE' });
    expect(duplicate.error?.message).toContain('duplicate key value');
  });

  it('regresses migration 026 by resolving Grid through the catalog before inserting', async () => {
    const result = await must(db.rpc('grant_internal_product_entitlement', { p_org_id: orgId, p_site_id: sameOrgSiteId,
      p_product_id: 'GRID_INTELLIGENCE', p_source: 'INTERNAL_TEST', p_valid_until: new Date(Date.now() + 86400000).toISOString(), p_reason: 'Grid FK regression' }));
    expect(result).toMatchObject({ status: 'INTERNAL_GRANTED', product_id: 'GRID_INTELLIGENCE' });
    const deprecated = await db.rpc('grant_internal_grid_entitlement', { p_org_id: orgId, p_site_id: sameOrgSiteId,
      p_source: 'INTERNAL_TEST', p_valid_until: new Date(Date.now() + 86400000).toISOString(), p_reason: 'Deprecated' });
    expect(deprecated.error).not.toBeNull();
  });

  it('blocks authenticated users from both privileged RPCs', async () => {
    const args = { p_org_id: orgId, p_site_id: sameOrgSiteId, p_source: 'INTERNAL_TEST',
      p_valid_until: new Date(Date.now() + 86400000).toISOString(), p_reason: 'Unauthorized' };
    expect((await userClient.rpc('grant_internal_all_product_entitlements', args)).error?.message).toContain('permission denied');
    expect((await userClient.rpc('grant_internal_product_entitlement', { ...args, p_product_id: 'DSM_RISK' })).error?.message).toContain('permission denied');
  });

  it('fails the all-products grant when an expected catalog module is unavailable', async () => {
    await must(db.from('products').update({ availability_status: 'RETIRED' }).eq('id', 'RENEWABLE_PORTFOLIO'));
    try {
      const { error } = await allGrant(otherOrgSiteId);
      expect(error?.message).toContain('EXPECTED_PRODUCT_CATALOG_INCOMPLETE');
    } finally {
      await must(db.from('products').update({ availability_status: 'DEMO' }).eq('id', 'RENEWABLE_PORTFOLIO'));
    }
  });
});
