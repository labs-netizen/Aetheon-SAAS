import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:15431';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe('Real PostgreSQL & Supabase RLS Integration Tests', () => {
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, storageKey: 'test-admin' },
  });

  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, storageKey: 'test-anon' },
  });

  const orgAId = 'a0000000-0000-0000-0000-000000000001';
  let orgBId: string;
  let userBId: string;
  let userBToken: string;

  beforeAll(async () => {
    // 1. Create Org B via admin client
    const { data: orgB, error: orgErr } = await adminClient
      .from('organisations')
      .insert({
        name: 'Integration Test Org B',
        legal_entity_name: 'Integration Test Org B Pvt Ltd',
        gstin: '29ABCDE1234F1Z5',
      })
      .select()
      .single();

    expect(orgErr).toBeNull();
    orgBId = orgB.id;

    // 2. Create a site for Org B
    const { error: siteErr } = await adminClient
      .from('sites')
      .insert({
        organisation_id: orgBId,
        name: 'Org B Manufacturing Plant',
        state: 'Karnataka',
        discom: 'BESCOM',
        voltage_category: '66kV',
        contract_demand_value: 3000,
        contract_demand_unit: 'kVA',
        metering_point: 'Feeder 2 Incomer',
        load_class: 'Precision Engineering',
        activation_status: 'CONFIGURED',
      });

    expect(siteErr).toBeNull();

    // 3. Create Auth User for Org B
    const testEmail = `org-b-${Date.now()}@test-aetheon.in`;
    const testPassword = 'Password123!Secure';

    const { data: authUser, error: authErr } = await adminClient.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { full_name: 'Org B Admin User' },
    });

    expect(authErr).toBeNull();
    userBId = authUser.user!.id;

    // Assign Org B user to Org B with ORGANISATION_ADMIN role
    const { error: memberErr } = await adminClient
      .from('memberships')
      .insert({
        organisation_id: orgBId,
        user_id: userBId,
        role: 'ORGANISATION_ADMIN',
      });

    expect(memberErr).toBeNull();

    // Sign in as User B to obtain genuine user session token
    const { data: sessionData, error: signInErr } = await anonClient.auth.signInWithPassword({
      email: testEmail,
      password: testPassword,
    });

    expect(signInErr).toBeNull();
    userBToken = sessionData.session!.access_token;
  });

  it('1. Anonymous clients cannot read tenant organisations under RLS', async () => {
    const unauthClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await unauthClient.from('organisations').select('*');
    // RLS filters out all rows for unauthenticated callers
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it('2. Public catalog (products) is readable by unauthenticated & authenticated clients', async () => {
    const { data, error } = await anonClient.from('products').select('*');
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(5);

    const productIds = data!.map((p: any) => p.id);
    expect(productIds).toContain('GRID_INTELLIGENCE');
    expect(productIds).toContain('OA_COMPLIANCE');
    expect(productIds).toContain('DSM_RISK');
    expect(productIds).toContain('BESS_ARBITRAGE');
    expect(productIds).toContain('RENEWABLE_PORTFOLIO');
  });

  it('3. User B authenticated client can read Org B data but CANNOT read Org A data', async () => {
    const clientB = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: `Bearer ${userBToken}`,
        },
      },
      auth: { persistSession: false },
    });

    // Query organisations
    const { data: orgs, error: orgErr } = await clientB.from('organisations').select('*');
    expect(orgErr).toBeNull();
    expect(orgs).toHaveLength(1);
    expect(orgs![0].id).toBe(orgBId);
    expect(orgs![0].id).not.toBe(orgAId);

    // Query sites
    const { data: sites, error: siteErr } = await clientB.from('sites').select('*');
    expect(siteErr).toBeNull();
    expect(sites).toHaveLength(1);
    expect(sites![0].organisation_id).toBe(orgBId);
  });

  it('4. User B cannot insert sites into Org A', async () => {
    const clientB = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: `Bearer ${userBToken}`,
        },
      },
      auth: { persistSession: false },
    });

    const { error } = await clientB.from('sites').insert({
      organisation_id: orgAId,
      name: 'Unauthorized Site Injection Attempt',
      state: 'Maharashtra',
      discom: 'MSEDCL',
      voltage_category: '33kV',
      contract_demand_value: 1000,
      contract_demand_unit: 'kVA',
      metering_point: 'Incomer 1',
    });

    // RLS with check constraint must deny the insert
    expect(error).not.toBeNull();
  });

  it('5. User B cannot see intervals or alerts belonging to Org A', async () => {
    const clientB = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: `Bearer ${userBToken}`,
        },
      },
      auth: { persistSession: false },
    });

    const { data: intervals } = await clientB.from('interval_data_96').select('*');
    expect(intervals).toHaveLength(0);

    const { data: alerts } = await clientB.from('alerts').select('*');
    expect(alerts).toHaveLength(0);
  });
});
