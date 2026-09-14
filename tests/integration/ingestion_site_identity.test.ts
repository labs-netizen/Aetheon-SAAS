import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { POST as commitIngestion } from '@/app/api/ingestion/commit/route';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const stamp = crypto.randomUUID();

async function must(promise: any): Promise<any> {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data;
}

function csv(load: number): string {
  return ['operating_date,block_index,load_kw', ...Array.from({ length: 96 }, (_, index) => `2026-08-20,${index + 1},${load}`)].join('\n');
}

describe('ingestion selected-site identity', () => {
  let db: SupabaseClient;
  let userId: string;
  let token: string;
  let ownOrgId: string;
  let foreignOrgId: string;
  let ownSiteId: string;
  let foreignSiteId: string;

  beforeAll(async () => {
    if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Local Supabase only');
    db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    ownOrgId = (await must(db.from('organisations').insert({ name: `Ingestion own ${stamp}`, legal_entity_name: 'Ingestion own fixture' }).select('id').single())).id;
    foreignOrgId = (await must(db.from('organisations').insert({ name: `Ingestion foreign ${stamp}`, legal_entity_name: 'Ingestion foreign fixture' }).select('id').single())).id;
    const created = await must(db.auth.admin.createUser({ email: `ingestion-site-${stamp}@example.com`, password: 'Strong-Test-Password!123', email_confirm: true }));
    userId = created.user.id;
    await must(db.from('memberships').insert({ organisation_id: ownOrgId, user_id: userId, role: 'ORGANISATION_ADMIN' }));
    const siteFields = { state: 'Maharashtra', discom: 'MSEDCL', voltage_category: '33kV', contract_demand_value: 1000, contract_demand_unit: 'kVA', metering_point: 'Main incomer', is_demo: false };
    ownSiteId = (await must(db.from('sites').insert({ ...siteFields, organisation_id: ownOrgId, name: 'Authenticated selected site' }).select('id').single())).id;
    foreignSiteId = (await must(db.from('sites').insert({ ...siteFields, organisation_id: foreignOrgId, name: 'Foreign site' }).select('id').single())).id;
    const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    token = (await must(authClient.auth.signInWithPassword({ email: `ingestion-site-${stamp}@example.com`, password: 'Strong-Test-Password!123' }))).session.access_token;
  });

  afterAll(async () => {
    if (db && ownOrgId) await db.from('organisations').delete().eq('id', ownOrgId);
    if (db && foreignOrgId) await db.from('organisations').delete().eq('id', foreignOrgId);
    if (db && userId) await db.auth.admin.deleteUser(userId);
  });

  const request = (siteId: string, load: number) => new NextRequest('http://localhost/api/ingestion/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ siteId, filename: `site-identity-${load}.csv`, csvText: csv(load) }),
  });

  it('commits to the real site selected by the authenticated user', async () => {
    const response = await commitIngestion(request(ownSiteId, 731));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, siteId: ownSiteId, validBlocks: 96 });
  });

  it('returns a clear 404 for a nonexistent site UUID', async () => {
    const missingId = crypto.randomUUID();
    const response = await commitIngestion(request(missingId, 732));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'SITE_NOT_FOUND', message: `Site '${missingId}' not found.` });
  });

  it('denies a foreign tenant site', async () => {
    const response = await commitIngestion(request(foreignSiteId, 733));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'FORBIDDEN_ORGANISATION' });
  });
});
