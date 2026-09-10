import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { POST as dsmPost } from '@/app/api/dsm/route';
import { POST as forecastPost } from '@/app/api/forecast/route';
import { POST as bessPost } from '@/app/api/bess/route';
import { POST as renewablesPost } from '@/app/api/renewables/route';
import { POST as sitePost } from '@/app/api/sites/route';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const stamp = crypto.randomUUID();
const operatingDate = '2026-08-15';

async function must(query: any): Promise<any> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

describe('Final acceptance operational mutation RBAC', () => {
  let db: SupabaseClient;
  let organisationId: string;
  let foreignOrganisationId: string;
  let siteId: string;
  const actors: Record<string, { id: string; token: string }> = {};

  const request = (path: string, token: string, body: unknown) => new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  beforeAll(async () => {
    if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Local Supabase only');
    db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    organisationId = (await must(db.from('organisations').insert({
      name: `Acceptance RBAC ${stamp}`,
      legal_entity_name: 'Acceptance RBAC fixture',
    }).select().single())).id;
    foreignOrganisationId = (await must(db.from('organisations').insert({
      name: `Foreign Acceptance RBAC ${stamp}`,
      legal_entity_name: 'Foreign acceptance RBAC fixture',
    }).select().single())).id;

    for (const role of ['ORGANISATION_ADMIN', 'ENERGY_MANAGER', 'OPERATOR', 'FINANCE_SUSTAINABILITY_VIEWER']) {
      const email = `acceptance-${role.toLowerCase()}-${stamp}@example.com`;
      const password = 'Acceptance-Strong-Password!123';
      const created = await must(db.auth.admin.createUser({ email, password, email_confirm: true }));
      const client = createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, storageKey: `acceptance-${role}-${stamp}` },
      });
      const signedIn = await must(client.auth.signInWithPassword({ email, password }));
      actors[role] = { id: created.user.id, token: signedIn.session.access_token };
      await must(db.from('memberships').insert({ organisation_id: organisationId, user_id: created.user.id, role }));
    }

    siteId = (await must(db.from('sites').insert({
      organisation_id: organisationId,
      name: 'Acceptance RBAC site',
      state: 'Maharashtra',
      discom: 'MSEDCL',
      voltage_category: '33kV',
      contract_demand_value: 1000,
      contract_demand_unit: 'kVA',
      metering_point: 'Main incomer',
      is_demo: false,
    }).select().single())).id;

    await must(db.from('site_access').insert(['ENERGY_MANAGER', 'OPERATOR', 'FINANCE_SUSTAINABILITY_VIEWER'].map((role) => ({
      site_id: siteId,
      user_id: actors[role].id,
    }))));
    await must(db.from('entitlements').insert(['GRID_INTELLIGENCE', 'DSM_RISK', 'BESS_ARBITRAGE', 'RENEWABLE_PORTFOLIO'].map((product_id) => ({
      organisation_id: organisationId,
      site_id: siteId,
      product_id,
      is_active: true,
    }))));
  });

  const endpoints = [
    ['GRID', '/api/forecast', forecastPost],
    ['DSM', '/api/dsm', dsmPost],
    ['BESS', '/api/bess', bessPost],
    ['renewables', '/api/renewables', renewablesPost],
  ] as const;

  it.each(['OPERATOR', 'FINANCE_SUSTAINABILITY_VIEWER'])(
    'denies %s access to every operational module POST',
    async (role) => {
      for (const [, path, handler] of endpoints) {
        const response = await handler(request(path, actors[role].token, { siteId, operatingDate }));
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ error: 'INSUFFICIENT_ROLE' });
      }
    }
  );

  it.each(['ORGANISATION_ADMIN', 'ENERGY_MANAGER'])(
    'allows %s through the operational module POST role gate',
    async (role) => {
      for (const [, path, handler] of endpoints) {
        const response = await handler(request(path, actors[role].token, { siteId, operatingDate }));
        expect(response.status).not.toBe(403);
        expect((await response.json()).error).not.toBe('INSUFFICIENT_ROLE');
      }
    }
  );

  it.each(['OPERATOR', 'FINANCE_SUSTAINABILITY_VIEWER'])(
    'rejects %s at commit_dsm_evaluation_atomic even through service-role transport',
    async (role) => {
      const { error } = await db.rpc('commit_dsm_evaluation_atomic', {
        p_site_id: siteId,
        p_org_id: organisationId,
        p_actor_id: actors[role].id,
        p_date: operatingDate,
        p_input_rows: [],
        p_input_checksum: '0'.repeat(64),
        p_result: {},
        p_incidents: [],
      });
      expect(error?.message).toContain('FORBIDDEN_ACTOR_AUTHORITY');
    }
  );

  it.each(['ORGANISATION_ADMIN', 'ENERGY_MANAGER'])(
    'accepts %s at the DSM role gate before rejecting invalid evidence',
    async (role) => {
      const { error } = await db.rpc('commit_dsm_evaluation_atomic', {
        p_site_id: siteId,
        p_org_id: organisationId,
        p_actor_id: actors[role].id,
        p_date: operatingDate,
        p_input_rows: [],
        p_input_checksum: '0'.repeat(64),
        p_result: {},
        p_incidents: [],
      });
      expect(error?.message).toContain('INVALID_DSM_EVIDENCE');
      expect(error?.message).not.toContain('INSUFFICIENT_ROLE');
    }
  );

  it('rejects site creation when the contract demand unit is omitted', async () => {
    const response = await sitePost(request('/api/sites', actors.ORGANISATION_ADMIN.token, {
      organisationId,
      name: 'Missing demand unit',
      state: 'Maharashtra',
      discom: 'MSEDCL',
      voltageCategory: '33kV',
      contractDemandValue: 1000,
      meteringPoint: 'Main incomer',
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'INVALID_DEMAND_UNIT' });
  });

  it.each([
    ['whitespace-only', '   '],
    ['unsupported', 'MW'],
  ])('rejects a %s contract demand unit', async (_, contractDemandUnit) => {
    const response = await sitePost(request('/api/sites', actors.ORGANISATION_ADMIN.token, {
      organisationId,
      name: `Invalid demand unit ${contractDemandUnit}`,
      state: 'Maharashtra',
      discom: 'MSEDCL',
      voltageCategory: '33kV',
      contractDemandValue: 1000,
      contractDemandUnit,
      meteringPoint: 'Main incomer',
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'INVALID_DEMAND_UNIT' });
  });

  it.each(['kVA', 'MVA'])('accepts %s past contract demand unit validation', async (contractDemandUnit) => {
    const response = await sitePost(request('/api/sites', actors.ORGANISATION_ADMIN.token, {
      organisationId,
      name: `Valid ${contractDemandUnit} site ${stamp}`,
      state: 'Maharashtra',
      discom: 'MSEDCL',
      voltageCategory: '33kV',
      contractDemandValue: 1000,
      contractDemandUnit,
      meteringPoint: 'Main incomer',
    }));
    expect(response.status).toBe(201);
  });

  it('allows an authenticated user to resolve their own organisation through active membership', async () => {
    const authenticated = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${actors.ENERGY_MANAGER.token}` } },
    });

    const { data: ownMembership, error: ownError } = await authenticated
      .from('memberships')
      .select(`
        role,
        is_active,
        organisation_id,
        organisations:organisation_id (id, name)
      `)
      .eq('user_id', actors.ENERGY_MANAGER.id)
      .eq('is_active', true)
      .single();

    expect(ownError).toBeNull();
    expect(ownMembership).toMatchObject({
      role: 'ENERGY_MANAGER',
      is_active: true,
      organisation_id: organisationId,
      organisations: { id: organisationId },
    });
  });

  it('does not expose another organisation to an authenticated tenant member', async () => {
    const authenticated = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${actors.ENERGY_MANAGER.token}` } },
    });

    const { data: foreignOrganisations, error: foreignOrganisationError } = await authenticated
      .from('organisations')
      .select('id')
      .eq('id', foreignOrganisationId);

    expect(foreignOrganisationError).toBeNull();
    expect(foreignOrganisations).toEqual([]);

    const { data: foreignMemberships, error: foreignError } = await authenticated
      .from('memberships')
      .select('organisation_id')
      .neq('organisation_id', organisationId);

    expect(foreignError).toBeNull();
    expect(foreignMemberships).toEqual([]);
  });

  it('allows authenticated bootstrap reads from organisations, entitlements, and sites', async () => {
    const authenticated = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${actors.ENERGY_MANAGER.token}` } },
    });

    const [organisationResult, entitlementResult, siteResult] = await Promise.all([
      authenticated.from('organisations').select('id').eq('id', organisationId).single(),
      authenticated.from('entitlements').select('product_id').eq('organisation_id', organisationId),
      authenticated.from('sites').select('id').eq('organisation_id', organisationId),
    ]);

    expect(organisationResult.error).toBeNull();
    expect(organisationResult.data?.id).toBe(organisationId);
    expect(entitlementResult.error).toBeNull();
    expect(entitlementResult.data).toHaveLength(4);
    expect(siteResult.error).toBeNull();
    expect(siteResult.data?.some((site) => site.id === siteId)).toBe(true);
  });
});
