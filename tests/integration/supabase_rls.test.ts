import { describe, it, expect, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { PATCH as sitePatch } from '@/app/api/sites/[id]/route';

describe('Real PostgreSQL & Supabase RLS Integration Tests', () => {
  let SUPABASE_URL: string;
  let SUPABASE_ANON_KEY: string;
  let SUPABASE_SERVICE_KEY: string;
  let adminClient: SupabaseClient;
  let anonClient: SupabaseClient;

  const orgAId = 'a0000000-0000-0000-0000-000000000001';
  let orgBId: string;
  let siteB1Id: string;
  let siteB2Id: string;
  let userBId: string;
  let userBToken: string;
  let operatorBId: string;
  let operatorBToken: string;

  beforeAll(async () => {
    SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:15431';
    SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

    if (!SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY) {
      throw new Error(
        'Supabase test keys missing. Please ensure NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are defined in .env.local'
      );
    }

    adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: 'test-admin' },
    });

    anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: 'test-anon' },
    });

    // 1. Create Org B via admin client
    const { data: orgB, error: orgErr } = await adminClient
      .from('organisations')
      .insert({
        name: 'Aetheon Demo Facility Beta Org',
        legal_entity_name: 'Aetheon Demo Facility Beta Pvt Ltd',
        gstin: '29ABCDE1234F1Z5',
      })
      .select()
      .single();

    expect(orgErr).toBeNull();
    orgBId = orgB.id;

    // 2. Create Site B1 and Site B2 for Org B
    const { data: site1, error: site1Err } = await adminClient
      .from('sites')
      .insert({
        organisation_id: orgBId,
        name: 'Org B Alpha Plant (Site B1)',
        state: 'Karnataka',
        discom: 'BESCOM',
        voltage_category: '66kV',
        contract_demand_value: 3000,
        contract_demand_unit: 'kVA',
        metering_point: 'Feeder 1 Incomer',
        load_class: 'Continuous Process Industrial (Demo)',
        activation_status: 'ACTIVE',
      })
      .select()
      .single();
    expect(site1Err).toBeNull();
    siteB1Id = site1.id;

    const { data: site2, error: site2Err } = await adminClient
      .from('sites')
      .insert({
        organisation_id: orgBId,
        name: 'Org B Beta Plant (Site B2)',
        state: 'Karnataka',
        discom: 'BESCOM',
        voltage_category: '33kV',
        contract_demand_value: 1500,
        contract_demand_unit: 'kVA',
        metering_point: 'Feeder 2 Incomer',
        load_class: 'Batch Manufacturing & Engineering',
        activation_status: 'AWAITING_DATA',
      })
      .select()
      .single();
    expect(site2Err).toBeNull();
    siteB2Id = site2.id;

    // Insert dummy interval data into Site B2
    const { error: insertIntervalErr } = await adminClient.from('interval_data_96').insert({
      site_id: siteB2Id,
      operating_date: '2026-09-01',
      block_index: 1,
      timestamp_utc: '2026-09-01T00:00:00Z',
      load_kw: 1200,
      actual_drawal_kw: 1200,
      scheduled_drawal_kw: 1200,
      data_quality: 'PASSED',
    });
    expect(insertIntervalErr).toBeNull();


    // 3. Create Auth User for Org B Admin
    const testAdminEmail = `org-b-admin-${Date.now()}@demo.aetheonlabs.in`;
    const testPassword = 'Password123!Secure';

    const { data: authAdmin, error: authAdminErr } = await adminClient.auth.admin.createUser({
      email: testAdminEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { full_name: 'Org B Admin User' },
    });
    expect(authAdminErr).toBeNull();
    userBId = authAdmin.user!.id;

    await adminClient.from('memberships').insert({
      organisation_id: orgBId,
      user_id: userBId,
      role: 'ORGANISATION_ADMIN',
    });

    const { data: adminSession } = await anonClient.auth.signInWithPassword({
      email: testAdminEmail,
      password: testPassword,
    });
    userBToken = adminSession.session!.access_token;

    // 4. Create Operator for Org B with access ONLY to Site B1
    const testOpEmail = `org-b-op-${Date.now()}@demo.aetheonlabs.in`;
    const { data: authOp, error: authOpErr } = await adminClient.auth.admin.createUser({
      email: testOpEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { full_name: 'Org B Operator' },
    });
    expect(authOpErr).toBeNull();
    operatorBId = authOp.user!.id;

    await adminClient.from('memberships').insert({
      organisation_id: orgBId,
      user_id: operatorBId,
      role: 'OPERATOR',
    });

    // Grant access ONLY to Site B1
    await adminClient.from('site_access').insert({
      site_id: siteB1Id,
      user_id: operatorBId,
      granted_by: userBId,
    });

    const { data: opSession } = await anonClient.auth.signInWithPassword({
      email: testOpEmail,
      password: testPassword,
    });
    operatorBToken = opSession.session!.access_token;
  });

  it('1. Anonymous clients cannot read tenant organisations under RLS', async () => {
    const unauthClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await unauthClient.from('organisations').select('*');
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
      global: { headers: { Authorization: `Bearer ${userBToken}` } },
      auth: { persistSession: false },
    });

    const { data: orgs, error: orgErr } = await clientB.from('organisations').select('*');
    expect(orgErr).toBeNull();
    expect(orgs).toHaveLength(1);
    expect(orgs![0].id).toBe(orgBId);
    expect(orgs![0].id).not.toBe(orgAId);
  });

  it('4. User B cannot insert sites into Org A', async () => {
    const clientB = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${userBToken}` } },
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
    expect(error).not.toBeNull();
  });

  it('5. User B cannot see intervals or alerts belonging to Org A', async () => {
    const clientB = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${userBToken}` } },
      auth: { persistSession: false },
    });

    const { data: intervals } = await clientB.from('interval_data_96').select('*');
    expect(intervals?.filter((i: any) => i.site_id === 'b0000000-0000-0000-0000-000000000001')).toHaveLength(0);

    const { data: alerts } = await clientB.from('alerts').select('*');
    expect(alerts?.filter((a: any) => a.organisation_id === orgAId)).toHaveLength(0);
  });

  it('6. Critical Security: Registration metadata CANNOT grant platform admin privileges', async () => {
    const attackerEmail = `attacker-${Date.now()}@demo.aetheonlabs.in`;
    const { data: attackUser, error: attackErr } = await adminClient.auth.admin.createUser({
      email: attackerEmail,
      password: 'Password123!Attack',
      email_confirm: true,
      // Malicious payload attempting privilege escalation
      user_metadata: {
        full_name: 'Malicious Attacker',
        is_platform_admin: true,
        role: 'super_admin',
      },
    });

    expect(attackErr).toBeNull();
    const attackerId = attackUser.user!.id;

    // Verify user_profiles record created by database trigger
    const { data: profile } = await adminClient
      .from('user_profiles')
      .select('id, is_platform_admin')
      .eq('id', attackerId)
      .single();

    expect(profile).toBeDefined();
    // Must be strictly FALSE
    expect(profile!.is_platform_admin).toBe(false);
  });

  it('7. Critical Security: Direct profile update cannot escalate is_platform_admin', async () => {
    const clientB = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${userBToken}` } },
      auth: { persistSession: false },
    });

    // Attempt to update own profile to is_platform_admin = true
    const { error } = await clientB
      .from('user_profiles')
      .update({ is_platform_admin: true })
      .eq('id', userBId);

    // Database trigger or RLS must deny this modification
    expect(error).not.toBeNull();

    // Verify in database that flag remains false
    const { data: profile } = await adminClient
      .from('user_profiles')
      .select('is_platform_admin')
      .eq('id', userBId)
      .single();

    expect(profile!.is_platform_admin).toBe(false);
  });

  it('8. Critical Security: Customer Org Admin CANNOT assign internal Aetheon roles', async () => {
    const clientB = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${userBToken}` } },
      auth: { persistSession: false },
    });

    // Attempt 1: Org Admin promotes self to AETHEON_ANALYST
    const { error: errSelf } = await clientB
      .from('memberships')
      .update({ role: 'AETHEON_ANALYST' })
      .eq('user_id', userBId)
      .eq('organisation_id', orgBId);

    expect(errSelf).not.toBeNull();

    // Attempt 2: Org Admin assigns AETHEON_REGULATORY_REVIEWER to operator
    const { error: errOther } = await clientB
      .from('memberships')
      .update({ role: 'AETHEON_REGULATORY_REVIEWER' })
      .eq('user_id', operatorBId)
      .eq('organisation_id', orgBId);

    expect(errOther).not.toBeNull();
  });

  it('9. Site-Level Isolation: User granted Site B1 CANNOT access Site B2 in same org', async () => {
    const clientOp = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${operatorBToken}` } },
      auth: { persistSession: false },
    });

    // Query sites: operator should ONLY see Site B1
    const { data: sites, error: siteErr } = await clientOp.from('sites').select('id, name');
    expect(siteErr).toBeNull();
    const siteIds = sites!.map((s: any) => s.id);

    expect(siteIds).toContain(siteB1Id);
    expect(siteIds).not.toContain(siteB2Id); // Strictly blocked from Site B2

    // Query interval data for Site B2 directly: must return 0 rows
    const { data: intervals } = await clientOp
      .from('interval_data_96')
      .select('*')
      .eq('site_id', siteB2Id);

    expect(intervals).toHaveLength(0);
  });

  it('10. Regulatory Review Boundary: Unapproved/REVIEW_PENDING sources are suppressed from customers', async () => {
    // 1. Insert an unapproved/review-pending source via admin client
    const { data: pendingSource, error: pErr } = await adminClient
      .from('regulatory_sources')
      .insert({
        jurisdiction: 'SERC',
        state: 'Maharashtra',
        document_title: 'Draft Unapproved Tariff Order 2026',
        document_date: '2026-09-01',
        effective_date: '2026-09-01',
        version: 'draft-v0.1',
        status: 'REVIEW_PENDING', // NOT PUBLISHED
      })
      .select()
      .single();
    expect(pErr).toBeNull();

    // 2. Insert a published approved source
    const { data: pubSource, error: pubErr } = await adminClient
      .from('regulatory_sources')
      .insert({
        jurisdiction: 'MERC',
        state: 'Maharashtra',
        document_title: 'Approved Final Tariff Order 2026',
        document_date: '2026-09-01',
        effective_date: '2026-09-01',
        version: 'final-v1.0',
        status: 'PUBLISHED', // PUBLISHED
      })
      .select()
      .single();
    expect(pubErr).toBeNull();

    // 3. Customer client (User B) queries regulatory sources
    const clientB = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${userBToken}` } },
      auth: { persistSession: false },
    });

    const { data: customerView } = await clientB.from('regulatory_sources').select('id, status');
    const visibleIds = customerView!.map((s: any) => s.id);

    // Published source must be visible
    expect(visibleIds).toContain(pubSource.id);
    // REVIEW_PENDING source must be strictly suppressed
    expect(visibleIds).not.toContain(pendingSource.id);
  });

  it('11. Server-Generated Data Protection: Customer cannot directly insert trusted forecast runs', async () => {
    const clientB = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${userBToken}` } },
      auth: { persistSession: false },
    });

    const { error } = await clientB.from('grid_forecast_runs').insert({
      site_id: siteB1Id,
      operating_date: '2026-09-05',
      model_version: 'FORGED_CUSTOMER_MODEL',
      average_price_inr_per_mwh: 1000,
      peak_demand_kw: 500,
      peak_demand_block: 50,
      quality_status: 'PASSED',
      freshness_status: 'RECENT',
    });

    // RLS policy requires service-role/admin; customer insert must be denied
    expect(error).not.toBeNull();
  });

  it('12. Direct Site Update Bypass: Authenticated Org Admin direct Supabase update is denied, DB value unchanged, and /api/sites/[id] normal config update succeeds', async () => {
    const clientB = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${userBToken}` } },
      auth: { persistSession: false },
    });

    // 1. Direct Supabase update attempt on activation_status
    const { data: updateData } = await clientB
      .from('sites')
      .update({ activation_status: 'ACTIVE' })
      .eq('id', siteB2Id)
      .select();

    // Denied under RLS: 0 rows returned
    expect(updateData).toHaveLength(0);

    // Verify DB value remains unchanged
    const { data: dbSite } = await adminClient.from('sites').select('activation_status').eq('id', siteB2Id).single();
    expect(dbSite!.activation_status).toBe('AWAITING_DATA');

    // 2. Normal site config update via /api/sites/[id] continues to work with server authority
    const req = new NextRequest(`http://localhost:3000/api/sites/${siteB1Id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userBToken}`,
      },
      body: JSON.stringify({
        contract_demand_value: 3500.0,
      }),
    });

    const res = await sitePatch(req, { params: { id: siteB1Id } });
    expect(res.status).toBe(200);
    const resData = await res.json();
    expect(resData.success).toBe(true);
    expect(resData.site.contract_demand_value).toBe(3500.0);
  });

  it('13. Direct Interval Insert Bypass: Authenticated customer direct INSERT to interval_data_96 is denied, canonical ingestion RPC succeeds', async () => {
    const clientB = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${userBToken}` } },
      auth: { persistSession: false },
    });

    // 1. Direct customer INSERT to interval_data_96 must be denied by RLS
    const { error: insertErr } = await clientB.from('interval_data_96').insert({
      site_id: siteB1Id,
      operating_date: '2026-09-02',
      block_index: 2,
      timestamp_utc: '2026-09-02T00:15:00Z',
      load_kw: 1100,
      actual_drawal_kw: 1100,
      scheduled_drawal_kw: 1100,
      data_quality: 'PASSED',
    });
    expect(insertErr).not.toBeNull();

    // 2. Canonical ingestion RPC via service role succeeds
    const rows96: any[] = [];
    for (let b = 1; b <= 96; b++) {
      rows96.push({
        block_index: b,
        operating_date: '2026-09-02',
        load_kw: 500.0,
        solar_generation_kw: 0.0,
        actual_drawal_kw: 500.0,
        scheduled_drawal_kw: 500.0,
      });
    }

    const { data: rpcRes, error: rpcErr } = await adminClient.rpc('commit_ingestion_transaction', {
      p_site_id: siteB1Id,
      p_filename: 'ingestion_canonical_test.csv',
      p_checksum_sha256: 'sha256_canonical_' + Date.now(),
      p_uploaded_by: userBId,
      p_rows: rows96,
      p_freshness_status: 'RECENT',
      p_actor_role: 'ORGANISATION_ADMIN',
      p_org_id: orgBId,
    });
    expect(rpcErr).toBeNull();
    expect(rpcRes.success).toBe(true);
  });

  it('14. BESS Trusted State: Authenticated customer cannot directly alter BESS state fields, but retains permitted SELECT', async () => {
    const clientB = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${userBToken}` } },
      auth: { persistSession: false },
    });

    // Create BESS asset for siteB1Id via service role adminClient
    const { data: bessAsset, error: bessErr } = await adminClient.from('bess_assets').insert({
      site_id: siteB1Id,
      name: 'Org B Hardened Battery',
      usable_capacity_kwh: 1000,
      power_rating_kw: 250,
      current_soc_pct: 50.0,
      min_soc_pct: 10.0,
      max_soc_pct: 90.0,
      maintenance_lock: false,
      last_telemetry_at: new Date().toISOString(),
    }).select().single();
    expect(bessErr).toBeNull();

    // 1. Direct alter attempt on current_soc_pct
    const { data: d1 } = await clientB.from('bess_assets').update({ current_soc_pct: 99.0 }).eq('id', bessAsset!.id).select();
    expect(d1).toHaveLength(0);

    // 2. Direct alter attempt on maintenance_lock
    const { data: d2 } = await clientB.from('bess_assets').update({ maintenance_lock: true }).eq('id', bessAsset!.id).select();
    expect(d2).toHaveLength(0);

    // 3. Direct alter attempt on last_telemetry_at
    const { data: d3 } = await clientB.from('bess_assets').update({ last_telemetry_at: '2020-01-01T00:00:00Z' }).eq('id', bessAsset!.id).select();
    expect(d3).toHaveLength(0);

    // 4. Direct alter attempt on min_soc_pct / max_soc_pct
    const { data: d4 } = await clientB.from('bess_assets').update({ min_soc_pct: 5.0, max_soc_pct: 95.0 }).eq('id', bessAsset!.id).select();
    expect(d4).toHaveLength(0);

    // 5. Verify DB state remains unchanged
    const { data: freshBess } = await adminClient.from('bess_assets').select('*').eq('id', bessAsset!.id).single();
    expect(freshBess!.current_soc_pct).toBe(50.0);
    expect(freshBess!.maintenance_lock).toBe(false);
    expect(freshBess!.min_soc_pct).toBe(10.0);
    expect(freshBess!.max_soc_pct).toBe(90.0);

    // 6. Verify permitted customer SELECT works
    const { data: customerBess, error: selectErr } = await clientB.from('bess_assets').select('*').eq('id', bessAsset!.id).single();
    expect(selectErr).toBeNull();
    expect(customerBess!.id).toBe(bessAsset!.id);
  });
});
