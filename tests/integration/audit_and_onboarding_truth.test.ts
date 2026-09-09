import { describe, it, expect, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

import { POST as orgCreatePost } from '@/app/api/organisations/create/route';
import { POST as reportGeneratePost } from '@/app/api/reports/generate/route';
import { GET as reportDownloadGet } from '@/app/api/reports/[id]/download/route';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:15431';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

describe('Pass B: Audit + Onboarding Truth Integration Tests', () => {
  let adminClient: SupabaseClient;
  let anonClient: SupabaseClient;
  let orgAdminUserToken: string;
  let orgAdminUserId: string;
  let testOrgId: string;
  let testSiteId: string;
  let testSubscriptionId: string;

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1. Create a test Org Admin user
    const testEmail = `passb-admin-${Date.now()}@aetheonenergy.in`;
    const testPassword = 'Password123!Secure';

    const { data: authData, error: authErr } = await adminClient.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { full_name: 'Pass B Admin User' },
    });
    if (authErr) throw authErr;
    orgAdminUserId = authData.user!.id;

    const { data: session } = await anonClient.auth.signInWithPassword({
      email: testEmail,
      password: testPassword,
    });
    orgAdminUserToken = session.session!.access_token;

    // 2. Create organization and site
    const { data: org } = await adminClient
      .from('organisations')
      .insert({
        name: `Pass B Test Org ${Date.now()}`,
        legal_entity_name: 'Pass B Test Org Pvt Ltd',
      })
      .select()
      .single();
    testOrgId = org.id;

    await adminClient.from('memberships').insert({
      organisation_id: testOrgId,
      user_id: orgAdminUserId,
      role: 'ORGANISATION_ADMIN',
    });

    const { data: site } = await adminClient
      .from('sites')
      .insert({
        organisation_id: testOrgId,
        name: 'Pass B Test Site 1',
        state: 'Maharashtra',
        discom: 'MSEDCL',
        voltage_category: '33kV',
        contract_demand_value: 2000.0,
        contract_demand_unit: 'kVA',
        metering_point: 'Main Incomer 33kV Feeder',
        activation_status: 'ACTIVE',
        is_demo: false,
      })
      .select()
      .single();
    testSiteId = site.id;

    await adminClient.from('site_access').insert({
      site_id: testSiteId,
      user_id: orgAdminUserId,
      granted_by: orgAdminUserId,
    });

    // 3. Create test subscription
    const { data: sub, error: subErr } = await adminClient
      .from('subscriptions')
      .insert({
        organisation_id: testOrgId,
        status: 'ACTIVE',
        billing_provider: 'MOCK',
        billing_provider_ref: `sub_mock_${Date.now()}`,
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        cancel_at_period_end: false,
      })
      .select()
      .single();
    if (subErr) throw subErr;
    testSubscriptionId = sub.id;

    // 4. Entitlement for DSM report testing
    await adminClient.from('entitlements').insert({
      organisation_id: testOrgId,
      site_id: testSiteId,
      product_id: 'DSM_RISK',
      is_active: true,
    });
  });

  // =========================================================================
  // 1. ATOMIC AUDIT FOR CRITICAL MUTATIONS
  // =========================================================================
  describe('1. Atomic Audit for Critical Mutations', () => {
    it('proves forced audit failure rolls back site configuration update', async () => {
      // 1. Check initial site name
      const { data: beforeSite } = await adminClient
        .from('sites')
        .select('name')
        .eq('id', testSiteId)
        .single();
      const originalName = beforeSite!.name;

      // 2. Invoke update_site_config_atomic with forced audit failure
      const { data: rpcRes, error: rpcErr } = await adminClient.rpc('update_site_config_atomic', {
        p_site_id: testSiteId,
        p_updates: { name: 'ILLEGAL_ROLLBACK_SITE_NAME' },
        p_actor_id: orgAdminUserId,
        p_actor_role: 'ORGANISATION_ADMIN',
        p_org_id: testOrgId,
        p_force_audit_failure: true,
      });

      // RPC must fail
      expect(rpcErr).not.toBeNull();
      expect(rpcErr!.message).toContain('FORCED_AUDIT_FAILURE_ROLLBACK');

      // 3. Verify site name was NOT modified in the database (rolled back)
      const { data: afterSite } = await adminClient
        .from('sites')
        .select('name')
        .eq('id', testSiteId)
        .single();
      expect(afterSite!.name).toBe(originalName);
      expect(afterSite!.name).not.toBe('ILLEGAL_ROLLBACK_SITE_NAME');
    });

    it('proves forced audit failure rolls back invitation creation', async () => {
      const rollbackEmail = `rollback-invite-${Date.now()}@example.com`;

      // Invoke create_invitation_atomic with forced audit failure
      const { error: rpcErr } = await adminClient.rpc('create_invitation_atomic', {
        p_org_id: testOrgId,
        p_email: rollbackEmail,
        p_role: 'ENERGY_MANAGER',
        p_site_id: testSiteId,
        p_token: 'rollback_token_with_at_least_32_characters',
        p_expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
        p_invited_by: orgAdminUserId,
        p_actor_role: 'ORGANISATION_ADMIN',
        p_force_audit_failure: true,
      });

      expect(rpcErr).not.toBeNull();
      expect(rpcErr!.message).toContain('FORCED_AUDIT_FAILURE_ROLLBACK');

      // Verify invitation was NOT saved in database
      const { data: invites } = await adminClient
        .from('organisation_invitations')
        .select('*')
        .eq('email', rollbackEmail);
      expect(invites).toHaveLength(0);
    });

    it('proves forced audit failure rolls back subscription cancellation', async () => {
      const { error: intentError } = await adminClient.rpc('prepare_subscription_cancellation', {
        p_subscription_id: testSubscriptionId, p_org_id: testOrgId,
        p_actor_id: orgAdminUserId, p_provider_mode: 'MOCK_DEVELOPMENT',
      });
      expect(intentError).toBeNull();
      // Invoke cancel_subscription_atomic with forced audit failure
      const { error: rpcErr } = await adminClient.rpc('cancel_subscription_atomic', {
        p_subscription_id: testSubscriptionId,
        p_org_id: testOrgId,
        p_actor_id: orgAdminUserId,
        p_actor_role: 'ORGANISATION_ADMIN',
        p_provider_mode: 'MOCK_DEVELOPMENT',
        p_product_id: 'DSM_RISK',
        p_force_audit_failure: true,
      });

      expect(rpcErr).not.toBeNull();
      expect(rpcErr!.message).toContain('FORCED_AUDIT_FAILURE_ROLLBACK');

      // Verify subscription cancel_at_period_end remains false
      const { data: sub } = await adminClient
        .from('subscriptions')
        .select('cancel_at_period_end')
        .eq('id', testSubscriptionId)
        .single();
      expect(sub!.cancel_at_period_end).toBe(false);
    });

    it('proves forced audit failure rolls back organisation, membership, and site creation', async () => {
      const freshEmail = `atomic-org-rollback-${Date.now()}@aetheonenergy.in`;
      const { data: newUser } = await adminClient.auth.admin.createUser({
        email: freshEmail,
        password: 'Password123!',
        email_confirm: true,
      });
      const newUserId = newUser.user!.id;
      const targetOrgName = `Rollback Target Org ${Date.now()}`;

      // Call create_organisation_atomic directly with p_force_audit_failure: true
      const { data: rpcRes, error: rpcErr } = await adminClient.rpc('create_organisation_atomic', {
        p_user_id: newUserId,
        p_user_email: freshEmail,
        p_org_name: targetOrgName,
        p_legal_entity_name: `${targetOrgName} Pvt Ltd`,
        p_site_params: {
          name: `${targetOrgName} Plant`,
          state: 'Maharashtra',
          discom: 'MSEDCL',
          voltage_category: '33kV',
          contract_demand_value: 1500,
          contract_demand_unit: 'kVA',
          metering_point: 'Incomer Feeder 1',
          is_demo: false,
        },
        p_force_audit_failure: true,
      });

      // Must fail with forced rollback exception
      expect(rpcErr).not.toBeNull();
      expect(rpcErr!.message).toContain('FORCED_AUDIT_FAILURE_ROLLBACK');

      // 1. Verify organisation was rolled back (does NOT exist)
      const { data: orgs } = await adminClient
        .from('organisations')
        .select('*')
        .eq('name', targetOrgName);
      expect(orgs).toHaveLength(0);

      // 2. Verify membership was rolled back (does NOT exist)
      const { data: memberships } = await adminClient
        .from('memberships')
        .select('*')
        .eq('user_id', newUserId);
      expect(memberships).toHaveLength(0);

      // 3. Verify site was rolled back (does NOT exist)
      const { data: sites } = await adminClient
        .from('sites')
        .select('*')
        .eq('name', `${targetOrgName} Plant`);
      expect(sites).toHaveLength(0);
    });

    it('proves HTTP endpoint /api/organisations/create rolls back all mutations on forced audit failure', async () => {
      const freshEmail = `http-org-rollback-${Date.now()}@aetheonenergy.in`;
      const { data: newUser } = await adminClient.auth.admin.createUser({
        email: freshEmail,
        password: 'Password123!',
        email_confirm: true,
      });
      const newUserId = newUser.user!.id;

      const { data: session } = await anonClient.auth.signInWithPassword({
        email: freshEmail,
        password: 'Password123!',
      });
      const token = session.session!.access_token;

      const targetOrgName = `HTTP Rollback Org ${Date.now()}`;

      const req = new NextRequest('http://localhost:3000/api/organisations/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: targetOrgName,
          legalEntityName: `${targetOrgName} Ltd`,
          siteName: `${targetOrgName} Site`,
          state: 'Maharashtra',
          discom: 'MSEDCL',
          voltageCategory: '33kV',
          contractDemandValue: 2500,
          contractDemandUnit: 'kVA',
          meteringPoint: 'Main Feeder 2',
          is_demo: false,
          force_audit_failure: true,
        }),
      });

      const res = await orgCreatePost(req);
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe('AUDIT_RECORDING_FAILED');

      // Verify ZERO database artifacts created
      const { data: orgs } = await adminClient.from('organisations').select('*').eq('name', targetOrgName);
      expect(orgs).toHaveLength(0);

      const { data: memberships } = await adminClient.from('memberships').select('*').eq('user_id', newUserId);
      expect(memberships).toHaveLength(0);

      const { data: sites } = await adminClient.from('sites').select('*').eq('name', `${targetOrgName} Site`);
      expect(sites).toHaveLength(0);
    });

    it('denies authenticated customer direct execution of atomic RPCs (service_role only)', async () => {
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${orgAdminUserToken}` } },
        auth: { persistSession: false },
      });

      // 1. Direct call to update_site_config_atomic
      const { error: err1 } = await userClient.rpc('update_site_config_atomic', {
        p_site_id: testSiteId,
        p_updates: { name: 'Direct Attacker Update' },
        p_actor_id: orgAdminUserId,
        p_actor_role: 'ORGANISATION_ADMIN',
        p_org_id: testOrgId,
      });
      expect(err1?.message).toContain('permission denied for function update_site_config_atomic');

      // 2. Direct call to create_invitation_atomic
      const { error: err2 } = await userClient.rpc('create_invitation_atomic', {
        p_org_id: testOrgId,
        p_email: 'attacker@evil.com',
        p_role: 'ORGANISATION_ADMIN',
        p_site_id: null,
        p_token: 'attack_token',
        p_expires_at: new Date().toISOString(),
        p_invited_by: orgAdminUserId,
        p_actor_role: 'ORGANISATION_ADMIN',
      });
      expect(err2?.message).toContain('permission denied for function create_invitation_atomic');

      // 3. Direct call to cancel_subscription_atomic
      const { error: err3 } = await userClient.rpc('cancel_subscription_atomic', {
        p_subscription_id: testSubscriptionId,
        p_org_id: testOrgId,
        p_actor_id: orgAdminUserId,
        p_actor_role: 'ORGANISATION_ADMIN',
        p_provider_mode: 'MOCK_DEVELOPMENT',
        p_product_id: 'DSM_RISK',
      });
      expect(err3?.message).toContain('permission denied for function cancel_subscription_atomic');

      // 4. Direct call to create_organisation_atomic
      const { error: err4 } = await userClient.rpc('create_organisation_atomic', {
        p_user_id: orgAdminUserId,
        p_user_email: 'direct@evil.com',
        p_org_name: 'Attacker Direct Org',
      });
      expect(err4?.message).toContain('permission denied for function create_organisation_atomic');
    });
  });

  // =========================================================================
  // 2. REMOVE ONBOARDING CONFIG FABRICATION
  // =========================================================================
  describe('2. Remove Onboarding Config Fabrication', () => {
    it('proves incomplete non-demo onboarding cannot silently create an operationally configured site', async () => {
      // 1. Create fresh authenticated user for onboarding
      const userEmail = `incomplete-onboarding-${Date.now()}@aetheonenergy.in`;
      const { data: newUser } = await adminClient.auth.admin.createUser({
        email: userEmail,
        password: 'Password123!',
        email_confirm: true,
      });

      const { data: userSession } = await anonClient.auth.signInWithPassword({
        email: userEmail,
        password: 'Password123!',
      });
      const token = userSession.session!.access_token;

      // 2. Call /api/organisations/create without required electrical config
      const req = new NextRequest('http://localhost:3000/api/organisations/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: `Unconfigured Industrial Corp ${Date.now()}`,
          legalEntityName: 'Unconfigured Industrial Corp Ltd',
          is_demo: false, // NON-DEMO
          // Missing: contractDemandValue, voltageCategory, meteringPoint
        }),
      });

      const res = await orgCreatePost(req);
      expect(res.status).toBe(201);
      const data = await res.json();

      // Must be flagged CONFIGURATION_REQUIRED with siteId: null
      expect(data.configurationStatus).toBe('CONFIGURATION_REQUIRED');
      expect(data.siteId).toBeNull();
      expect(data.site).toBeNull();

      // Database verification: ZERO sites fabricated in DB for this organisation
      const { data: sitesInDb } = await adminClient
        .from('sites')
        .select('*')
        .eq('organisation_id', data.organisationId);

      expect(sitesInDb).toHaveLength(0);
    });

    it('proves registration trigger does not fabricate site when non-demo electrical metadata is missing', async () => {
      const regEmail = `reg-nofab-${Date.now()}@aetheonenergy.in`;
      const orgName = `Reg NoFab Org ${Date.now()}`;

      // Sign up non-demo user with organisation_name and site_name but NO electrical parameters
      const { data: regUser, error: regErr } = await adminClient.auth.admin.createUser({
        email: regEmail,
        password: 'Password123!',
        email_confirm: true,
        user_metadata: {
          organisation_name: orgName,
          site_name: 'Unconfigured Plant Feeder',
          is_demo: false,
          // Missing: contract_demand_value, voltage_category, metering_point
        },
      });

      expect(regErr).toBeNull();

      // Find created org
      const { data: org } = await adminClient
        .from('organisations')
        .select('id')
        .eq('name', orgName)
        .single();

      expect(org).toBeDefined();

      // Verify no site was fabricated
      const { data: sites } = await adminClient
        .from('sites')
        .select('*')
        .eq('organisation_id', org!.id);

      expect(sites).toHaveLength(0);
    });

    it('proves non-demo registration with missing contract_demand_unit defers site creation (no fabricated unit)', async () => {
      const regEmail = `reg-nounit-${Date.now()}@aetheonenergy.in`;
      const orgName = `Reg NoUnit Org ${Date.now()}`;

      // Sign up non-demo user with demand, voltage, metering, but MISSING contract_demand_unit
      const { data: regUser, error: regErr } = await adminClient.auth.admin.createUser({
        email: regEmail,
        password: 'Password123!',
        email_confirm: true,
        user_metadata: {
          organisation_name: orgName,
          site_name: 'No Unit Plant Feeder',
          state: 'Maharashtra',
          discom: 'MSEDCL',
          voltage_category: '33kV',
          metering_point: 'Main Incomer 33kV Feeder',
          contract_demand_value: 1200,
          // contract_demand_unit is OMITTED (must NOT default to 'kVA')
          is_demo: false,
        },
      });

      expect(regErr).toBeNull();

      const { data: org } = await adminClient
        .from('organisations')
        .select('id')
        .eq('name', orgName)
        .single();

      expect(org).toBeDefined();

      // Site creation MUST be deferred (no site created because required unit was absent)
      const { data: sites } = await adminClient
        .from('sites')
        .select('*')
        .eq('organisation_id', org!.id);

      expect(sites).toHaveLength(0);
    });

    it('proves non-demo registration with complete electrical parameters creates configured site', async () => {
      const regEmail = `reg-complete-${Date.now()}@aetheonenergy.in`;
      const orgName = `Reg Complete Org ${Date.now()}`;

      // Sign up non-demo user with ALL required electrical parameters
      const { data: regUser, error: regErr } = await adminClient.auth.admin.createUser({
        email: regEmail,
        password: 'Password123!',
        email_confirm: true,
        user_metadata: {
          organisation_name: orgName,
          site_name: 'Configured Plant Feeder',
          state: 'Maharashtra',
          discom: 'MSEDCL',
          voltage_category: '33kV',
          metering_point: 'Main Incomer 33kV Feeder',
          contract_demand_value: 3000,
          contract_demand_unit: 'kVA',
          is_demo: false,
        },
      });

      expect(regErr).toBeNull();

      const { data: org } = await adminClient
        .from('organisations')
        .select('id')
        .eq('name', orgName)
        .single();

      expect(org).toBeDefined();

      const { data: sites } = await adminClient
        .from('sites')
        .select('*')
        .eq('organisation_id', org!.id);

      expect(sites).toHaveLength(1);
      expect(sites![0].contract_demand_value).toBe(3000);
      expect(sites![0].contract_demand_unit).toBe('kVA');
      expect(sites![0].voltage_category).toBe('33kV');
      expect(sites![0].metering_point).toBe('Main Incomer 33kV Feeder');
    });
  });

  // =========================================================================
  // 3. DSM REPORT RULE FALLBACK
  // =========================================================================
  describe('3. DSM Report Rule Fallback & Provenance Verification', () => {
    it('blocks legacy DSM report generation and download without verifiable input provenance', async () => {
      const operatingDate = '2026-09-03';

      // 1. Seed dsm_evaluation_runs with missing rule authority (REGULATORY_CONFIGURATION_REQUIRED)
      const { error: runError } = await adminClient.from('dsm_evaluation_runs').upsert({
        site_id: testSiteId,
        operating_date: operatingDate,
        input_completeness: 100.0,
        validation_status: 'PASSED',
        rule_version: 'UNKNOWN',
        rule_status: 'REGULATORY_CONFIGURATION_REQUIRED',
        model_version: 'DSM_INTERNAL_VALIDATION_v1.0',
        result_status: 'EVALUATED',
      }, { onConflict: 'site_id,operating_date' });
      expect(runError).toBeNull();

      // 2. Seed 1 incident with monetary exposure
      await adminClient.from('dsm_incidents').delete().eq('site_id', testSiteId).eq('operating_date', operatingDate);
      const { error: incidentError } = await adminClient.from('dsm_incidents').insert({
        site_id: testSiteId,
        operating_date: operatingDate,
        start_block: 30,
        end_block: 35,
        severity: 'HIGH',
        max_deviation_pct: 18.5,
        total_excess_energy_kwh: 450.0,
        estimated_exposure_inr: 8500.0,
        root_cause_tag: 'UNSCHEDULED_PEAK',
      });
      expect(incidentError).toBeNull();

      // 3. Request DSM_MONTHLY_REVIEW report
      const req = new NextRequest('http://localhost:3000/api/reports/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${orgAdminUserToken}`,
        },
        body: JSON.stringify({
          siteId: testSiteId,
          reportType: 'DSM_MONTHLY_REVIEW',
          periodStart: operatingDate,
          periodEnd: operatingDate,
        }),
      });

      const res = await reportGeneratePost(req);
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ error:'REPORT_NOT_PUBLISHABLE',reason:'REPORT_DATA_GAP' });
      const { data: created, error: queryError } = await adminClient.from('report_records').select('id').eq('site_id',testSiteId);
      expect(queryError).toBeNull();expect(created).toHaveLength(0);

      // A pre-existing CSV cannot bypass the same evidence check at download time.
      const { data: legacy, error: legacyError } = await adminClient.from('report_records').insert({
        organisation_id:testOrgId,site_id:testSiteId,module:'DSM',report_type:'DSM_MONTHLY_REVIEW',
        period_start:operatingDate,period_end:operatingDate,title:'Legacy unverified report',model_version:'DSM_INTERNAL_VALIDATION_v1.0',
        quality_status:'QUALITY_UNKNOWN',summary:{ csv_content:'UNVERIFIED_MONETARY_EXPOSURE,8500' }
      }).select('id').single();
      expect(legacyError).toBeNull();
      const downloadReq = new NextRequest(`http://localhost:3000/api/reports/${legacy!.id}/download`, {
        headers: { Authorization: `Bearer ${orgAdminUserToken}` },
      });
      const dlRes = await reportDownloadGet(downloadReq, { params: { id: legacy!.id } });
      expect(dlRes.status).toBe(422);
    });
  });
});
