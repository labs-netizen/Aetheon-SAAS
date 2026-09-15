import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { authorizeMarketDataAdmin } from '@/lib/auth/market-data-admin';
import { GET as adminAccess } from '@/app/api/admin/access/route';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const stamp = crypto.randomUUID();
const must = async (query: any) => { const { data, error } = await query; if (error) throw new Error(error.message); return data; };

describe('temporary internal AETHEON_ANALYST access', () => {
  let db: SupabaseClient;
  let userId: string;
  let foreignUserId: string;
  let token: string;
  let foreignToken: string;
  let orgId: string;
  let foreignOrgId: string;
  const request = (value: string) => new NextRequest('http://localhost/api/admin/access', { headers: { Authorization: `Bearer ${value}` } });

  beforeAll(async () => {
    db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    orgId = (await must(db.from('organisations').insert({ name: `Temporary analyst ${stamp}`, legal_entity_name: 'Temporary analyst fixture' }).select('id').single())).id;
    foreignOrgId = (await must(db.from('organisations').insert({ name: `Foreign customer ${stamp}`, legal_entity_name: 'Foreign customer fixture' }).select('id').single())).id;
    const password = 'Strong-Test-Password!123';
    const user = await must(db.auth.admin.createUser({ email: `temporary-analyst-${stamp}@example.com`, password, email_confirm: true }));
    const foreign = await must(db.auth.admin.createUser({ email: `foreign-admin-${stamp}@example.com`, password, email_confirm: true }));
    userId = user.user.id; foreignUserId = foreign.user.id;
    await must(db.from('memberships').insert([
      { organisation_id: orgId, user_id: userId, role: 'ORGANISATION_ADMIN' },
      { organisation_id: foreignOrgId, user_id: foreignUserId, role: 'ORGANISATION_ADMIN' },
    ]));
    const ownAuth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const foreignAuth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    token = (await must(ownAuth.auth.signInWithPassword({ email: user.user.email!, password }))).session.access_token;
    foreignToken = (await must(foreignAuth.auth.signInWithPassword({ email: foreign.user.email!, password }))).session.access_token;
  });

  afterAll(async () => {
    if (db && userId) await db.rpc('revoke_temporary_aetheon_analyst', { p_user_id: userId, p_reason: 'Test cleanup' });
    if (db && orgId) await db.from('organisations').delete().eq('id', orgId);
    if (db && foreignOrgId) await db.from('organisations').delete().eq('id', foreignOrgId);
    if (db && userId) await db.auth.admin.deleteUser(userId);
    if (db && foreignUserId) await db.auth.admin.deleteUser(foreignUserId);
  });

  it('keeps ordinary and foreign organisation administrators denied without platform escalation', async () => {
    expect((await authorizeMarketDataAdmin(request(token))).authorized).toBe(false);
    expect((await authorizeMarketDataAdmin(request(foreignToken))).authorized).toBe(false);
    expect(await must(db.from('memberships').select('role').eq('user_id', userId).single())).toEqual({ role: 'ORGANISATION_ADMIN' });
    expect(await must(db.from('user_profiles').select('is_platform_admin').eq('id', userId).single())).toEqual({ is_platform_admin: false });
  });

  it('prevents customers from self-granting and enforces the 90-day ceiling', async () => {
    const customer = createClient(url, anonKey, { accessToken: async () => token });
    expect((await customer.rpc('grant_temporary_aetheon_analyst', {
      p_user_id: userId, p_expires_at: new Date(Date.now() + 86400000).toISOString(), p_reason: 'Self grant attempt',
    })).error).toBeTruthy();
    expect((await db.rpc('grant_temporary_aetheon_analyst', {
      p_user_id: userId, p_expires_at: new Date(Date.now() + 91 * 86400000).toISOString(), p_reason: 'Too long',
    })).error?.message).toContain('INVALID_ANALYST_EXPIRY');
  });

  it('allows an audited 30-day grant while preserving the customer tenant role', async () => {
    expect(await must(db.rpc('grant_temporary_aetheon_analyst', {
      p_user_id: userId, p_expires_at: new Date(Date.now() + 30 * 86400000).toISOString(), p_reason: 'Authorized internal market-data testing',
    }))).toMatchObject({ status: 'GRANTED', user_id: userId, role: 'AETHEON_ANALYST' });
    expect(await authorizeMarketDataAdmin(request(token))).toMatchObject({ authorized: true, actorId: userId, accessRole: 'AETHEON_ANALYST' });
    expect(await (await adminAccess(request(token))).json()).toEqual({ authorized: true, role: 'AETHEON_ANALYST' });
    expect((await db.rpc('commit_iex_dam_market_prices', {
      p_actor_id: userId, p_source_file_name: 'authority-check.csv', p_source_file_hash: 'a'.repeat(64),
      p_source_reference: 'https://iexindia.com/market-data/day-ahead-market', p_published_at: null,
      p_fetched_at: new Date().toISOString(), p_rows: [],
    })).error?.message).toContain('EMPTY_MARKET_PRICE_IMPORT');
    expect(await must(db.from('memberships').select('role').eq('user_id', userId).single())).toEqual({ role: 'ORGANISATION_ADMIN' });
    expect(await must(db.from('user_profiles').select('is_platform_admin').eq('id', userId).single())).toEqual({ is_platform_admin: false });
    const audit = await must(db.from('audit_logs').select('action,details').eq('action', 'TEMPORARY_AETHEON_ANALYST_GRANTED')
      .contains('details', { user_id: userId }).order('id', { ascending: false }).limit(1).single());
    expect(audit.details).toMatchObject({ user_id: userId, role: 'AETHEON_ANALYST', reason: 'Authorized internal market-data testing' });
  });

  it('revokes access immediately and records the reason', async () => {
    expect(await must(db.rpc('revoke_temporary_aetheon_analyst', { p_user_id: userId, p_reason: 'Internal test completed' })))
      .toMatchObject({ status: 'REVOKED', user_id: userId });
    expect((await authorizeMarketDataAdmin(request(token))).authorized).toBe(false);
    const grant = await must(db.from('internal_access_grants').select('is_active,revoked_at,revocation_reason').eq('user_id', userId).single());
    expect(grant).toMatchObject({ is_active: false, revocation_reason: 'Internal test completed' });
    expect(grant.revoked_at).toBeTruthy();
  });

  it('denies an expired analyst grant', async () => {
    await must(db.rpc('grant_temporary_aetheon_analyst', {
      p_user_id: userId, p_expires_at: new Date(Date.now() + 1200).toISOString(), p_reason: 'Expiry boundary test',
    }));
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect((await authorizeMarketDataAdmin(request(token))).authorized).toBe(false);
  });
});
