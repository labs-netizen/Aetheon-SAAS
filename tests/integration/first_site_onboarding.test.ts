import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { POST as createSite } from '@/app/api/sites/route';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const stamp = crypto.randomUUID();

async function must(query: any): Promise<any> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

describe('verified signup first-site onboarding', () => {
  let admin: SupabaseClient;
  let authenticated: SupabaseClient;
  let userId: string;
  let accessToken: string;
  let organisationId: string;
  let foreignOrganisationId: string;

  const siteRequest = (targetOrganisationId: string, name: string) => new NextRequest(
    'http://localhost/api/sites',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        organisationId: targetOrganisationId,
        name,
        state: 'Maharashtra',
        discom: 'MSEDCL',
        voltageCategory: '33kV',
        contractDemandValue: 1500,
        contractDemandUnit: 'kVA',
        meteringPoint: 'Main Incomer Feeder 1',
        loadClass: 'Industrial C&I',
      }),
    }
  );

  beforeAll(async () => {
    if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
      throw new Error('Local Supabase only');
    }

    admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const email = `first-site-${stamp}@example.com`;
    const password = 'First-Site-Strong-Password!123';
    const organisationName = `First Site Organisation ${stamp}`;

    const created = await must(admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: 'First Site Administrator',
        organisation_name: organisationName,
      },
    }));
    userId = created.user.id;

    const signInClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: `first-site-${stamp}` },
    });
    const signedIn = await must(signInClient.auth.signInWithPassword({ email, password }));
    accessToken = signedIn.session.access_token;
    authenticated = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    foreignOrganisationId = (await must(admin.from('organisations').insert({
      name: `Foreign First Site Organisation ${stamp}`,
      legal_entity_name: 'Foreign first-site fixture',
    }).select('id').single())).id;
  });

  it('resolves the signup-created active Organisation Admin membership', async () => {
    const membership = await must(authenticated
      .from('memberships')
      .select('organisation_id, role, is_active, organisations:organisation_id(id)')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single());

    organisationId = membership.organisation_id;
    expect(membership).toMatchObject({
      role: 'ORGANISATION_ADMIN',
      is_active: true,
      organisations: { id: organisationId },
    });
  });

  it('creates the first site for the organisation resolved from that membership', async () => {
    const response = await createSite(siteRequest(organisationId, `First Facility ${stamp}`));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      success: true,
      site: { organisation_id: organisationId },
    });
  });

  it('denies first-site creation for another organisation', async () => {
    const response = await createSite(siteRequest(foreignOrganisationId, `Foreign Facility ${stamp}`));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'FORBIDDEN_ORGANISATION' });
  });
});
