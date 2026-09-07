/**
 * Adversarial API & Authorization Direct Route Test Suite
 * Directly invokes Next.js backend API routes to assert server rejection of unauthorized,
 * cross-tenant, cross-site, unentitled, and malicious payloads.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as forecastPost } from '@/app/api/forecast/route';
import { POST as dsmPost } from '@/app/api/dsm/route';
import { POST as bessPost } from '@/app/api/bess/route';
import { POST as ingestionCommitPost } from '@/app/api/ingestion/commit/route';
import { PATCH as sitePatch } from '@/app/api/sites/[id]/route';
import { POST as invitationSendPost } from '@/app/api/invitations/send/route';
import { POST as webhookPost } from '@/app/api/webhooks/razorpay/route';
import { POST as billingCancelPost } from '@/app/api/billing/cancel/route';
import { POST as invitationAcceptPost } from '@/app/api/invitations/accept/route';
import { GET as adminAuditGet } from '@/app/api/admin/audit/route';
import { GET as complianceGet } from '@/app/api/compliance/route';
import { POST as reportsGeneratePost } from '@/app/api/reports/generate/route';
import { GET as reportsDownloadGet } from '@/app/api/reports/[id]/download/route';
import { POST as checkoutPost } from '@/app/api/billing/checkout/route';
import { GET as forecastGet } from '@/app/api/forecast/route';
import { createClient } from '@supabase/supabase-js';
import CryptoJS from 'crypto-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:15431';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

describe('Adversarial API & Server Rejection Suite', () => {
  let userAToken: string;
  let userBToken: string;
  let adminClient: any;
  let orgAId: string;
  let orgBId: string;
  let siteAId: string;
  let siteBId: string;
  let subAId: string;

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: 'test-admin-adv' },
    });
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: 'test-anon-adv' },
    });

    // 1. Sign in Org A Admin (Rajesh Sharma)
    const { data: authA, error: authAErr } = await client.auth.signInWithPassword({
      email: 'rajesh.demo@demo.aetheonlabs.in',
      password: 'AetheonDemo2026!',
    });
    if (authAErr) console.error('authA error:', authAErr);
    expect(authA?.session?.access_token).toBeDefined();
    userAToken = authA.session!.access_token;
    orgAId = 'a0000000-0000-0000-0000-000000000001';
    siteAId = 'b0000000-0000-0000-0000-000000000001';

    // 2. Sign in Org A Operator (Sunil Pawar)
    const { data: authB, error: authBErr } = await client.auth.signInWithPassword({
      email: 'sunil.demo@demo.aetheonlabs.in',
      password: 'AetheonDemo2026!',
    });
    if (authBErr) console.error('authB error:', authBErr);
    expect(authB?.session?.access_token).toBeDefined();
    userBToken = authB.session!.access_token;

    const operatorUserId = authB.session!.user.id;
    // Ensure membership has operator role
    await adminClient.from('memberships').upsert({
      organisation_id: orgAId,
      user_id: operatorUserId,
      role: 'OPERATOR',
      is_active: true,
    }, { onConflict: 'organisation_id,user_id' });

    // Grant Sunil Pawar explicit site access to siteAId so role restrictions can be tested
    await adminClient.from('site_access').upsert({
      site_id: siteAId,
      user_id: operatorUserId,
    }, { onConflict: 'site_id,user_id' });

    // 3. Create a distinct Org B and Site B via admin client for cross-tenant tests
    const suffix = Date.now().toString().slice(-6);
    const { data: orgB, error: orgBErr } = await adminClient
      .from('organisations')
      .insert({
        name: `Adversarial Org B ${suffix}`,
        legal_entity_name: `Adversarial Org B Entity ${suffix}`,
        is_active: true,
      })
      .select('id')
      .single();

    if (orgBErr) {
      console.error('orgB insert error:', orgBErr);
      throw new Error(`Failed to create test Org B: ${orgBErr.message}`);
    }
    orgBId = orgB.id;

    const { data: siteB } = await adminClient
      .from('sites')
      .insert({
        organisation_id: orgBId,
        name: `Adversarial Site B ${suffix}`,
        state: 'Gujarat',
        discom: 'UGVCL',
        voltage_category: '66kV',
        contract_demand_value: 5000,
        contract_demand_unit: 'kVA',
        metering_point: 'HT Feeder 1',
        load_class: 'Continuous',
        activation_status: 'ACTIVE',
      })
      .select('id')
      .single();
    siteBId = siteB.id;

    // 4. Ensure a subscription exists for Org A
    const { data: sub } = await adminClient
      .from('subscriptions')
      .upsert({
        organisation_id: orgAId,
        status: 'ACTIVE',
        billing_provider: 'MOCK',
        billing_provider_ref: `sub_test_${suffix}`,
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
      })
      .select('id')
      .single();
    subAId = sub.id;
  });

  // 1. Unauthorized Request (No credentials when demo mode is false)
  it('1. Unauthorized Request: Direct API call without session/Bearer is rejected with 401', async () => {
    const prevDemo = process.env.NEXT_PUBLIC_DEMO_MODE;
    process.env.NEXT_PUBLIC_DEMO_MODE = 'false';

    try {
      const req = new NextRequest('http://localhost:3000/api/forecast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: siteAId,
          operatingDate: '2026-09-08',
          contractDemandKw: 2500,
        }),
      });

      const res = await forecastPost(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('UNAUTHENTICATED');
    } finally {
      process.env.NEXT_PUBLIC_DEMO_MODE = prevDemo;
    }
  });

  // 2. Cross-Tenant Isolation: User A cannot invoke API for Org B's site
  it('2. Cross-Tenant: User A cannot access site belonging to Org B (403 FORBIDDEN_ORGANISATION)', async () => {
    const req = new NextRequest('http://localhost:3000/api/forecast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        siteId: siteBId, // Belongs to Org B!
        operatingDate: '2026-09-08',
        contractDemandKw: 5000,
      }),
    });

    const res = await forecastPost(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('FORBIDDEN_ORGANISATION');
  });

  // 3. Unsubscribed Product Gating: Requesting unsubscribed module returns 403
  it('3. Unsubscribed Module: Accessing unentitled product returns 403 UNSUBSCRIBED', async () => {
    const prevDemo = process.env.NEXT_PUBLIC_DEMO_MODE;
    process.env.NEXT_PUBLIC_DEMO_MODE = 'true';

    try {
      // In demo mode, OA_COMPLIANCE is deliberately unsubscribed
      const req = new NextRequest('http://localhost:3000/api/forecast', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          siteId: siteAId,
          operatingDate: '2026-09-08',
          contractDemandKw: 2500,
        }),
      });

      const { authorizeApiRequest } = await import('@/lib/auth/api-guard');
      const authResult = await authorizeApiRequest(req, {
        siteId: siteAId,
        productId: 'OA_COMPLIANCE',
      });

      expect(authResult.authorized).toBe(false);
      if (!authResult.authorized) {
        expect(authResult.response.status).toBe(403);
        const json = await authResult.response.json();
        expect(json.error).toBe('UNSUBSCRIBED');
      }
    } finally {
      process.env.NEXT_PUBLIC_DEMO_MODE = prevDemo;
    }
  });

  // 4. Insufficient Role: Operator cannot modify site parameters
  it('4. Insufficient Role: OPERATOR cannot modify site parameters (403 INSUFFICIENT_ROLE)', async () => {
    const req = new NextRequest(`http://localhost:3000/api/sites/${siteAId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userBToken}`, // Operator Sunil Pawar
      },
      body: JSON.stringify({
        contract_demand_value: 9999,
      }),
    });

    const res = await sitePatch(req, { params: { id: siteAId } });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('INSUFFICIENT_ROLE');
  });

  // 5. Internal-Role Escalation Attempt: Org Admin cannot invite internal roles
  it('5. Internal Role Escalation: Org Admin cannot invite an AETHEON_ANALYST (403 FORBIDDEN_ROLE)', async () => {
    const req = new NextRequest('http://localhost:3000/api/invitations/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`, // Org Admin Rajesh Sharma
      },
      body: JSON.stringify({
        organisationId: orgAId,
        email: 'attacker@external.com',
        role: 'AETHEON_ANALYST', // Malicious internal role escalation
      }),
    });

    const res = await invitationSendPost(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('FORBIDDEN_ROLE');
  });

  // 6. Missing DSM Schedule/Actual Data -> Suppresses result
  it('6. Missing DSM Inputs: Missing schedule or actual meter data returns suppressed result', async () => {
    const req = new NextRequest('http://localhost:3000/api/dsm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        siteId: siteAId,
        operatingDate: '2026-01-01', // Date with no persisted interval data
        contractDemandKw: 2500,
        scheduledDrawalKw: [], // Missing schedule!
        actualDrawalKw: [],
      }),
    });

    const res = await dsmPost(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.is_suppressed).toBe(true);
    expect(json.suppression_reason).toContain('MISSING_DATA');
  });

  // 7. Invalid BESS SOC -> Safety Interlock Hard Suppresses Recommendation
  it('7. Invalid BESS SOC: Unknown/negative SOC triggers backend SAFETY_INTERLOCK suppression', async () => {
    const req = new NextRequest('http://localhost:3000/api/bess', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        batteryId: 'bess-001',
        siteId: siteAId,
        operatingDate: '2026-09-08',
        usableCapacityKwh: 1000,
        powerRatingKw: 500,
        initialSocPct: -15, // Invalid SOC!
        pricesInrPerMwh: [4500, 4800],
      }),
    });

    const res = await bessPost(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.is_suppressed).toBe(true);
    expect(json.suppression_reason).toContain('SAFETY_INTERLOCK');
  });

  // 8. Duplicate Ingestion Rejection via SHA-256 Checksum
  it('8. Duplicate Ingestion: Re-submitting identical checksum returns 409 DUPLICATE_FILE', async () => {
    // Generate valid 96 blocks with a run-unique baseLoad
    const runSalt = Date.now() % 10000;
    const parsedBlocks = [];
    for (let b = 1; b <= 96; b++) {
      parsedBlocks.push({
        operating_date: '2026-09-08',
        block_index: b,
        start_time: '00:00',
        end_time: '00:15',
        load_kw: 250.0 + runSalt,
      });
    }

    const testChecksum = 'checksum_test_' + Date.now();

    // 1st Commit
    const req1 = new NextRequest('http://localhost:3000/api/ingestion/commit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        siteId: siteAId,
        filename: 'test_amr_96block.csv',
        checksum: testChecksum,
        parsedData: parsedBlocks,
      }),
    });

    const res1 = await ingestionCommitPost(req1);
    expect(res1.status).toBe(200);

    // 2nd Commit (Duplicate attempt)
    const req2 = new NextRequest('http://localhost:3000/api/ingestion/commit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        siteId: siteAId,
        filename: 'test_amr_96block.csv',
        checksum: testChecksum, // Identical checksum!
        parsedData: parsedBlocks,
      }),
    });

    const res2 = await ingestionCommitPost(req2);
    expect(res2.status).toBe(409);
    const json2 = await res2.json();
    expect(json2.error).toBe('DUPLICATE_FILE');
  }, 15000);

  // 9. Repeated Webhook Replay Atomicity
  it('9. Webhook Idempotency: Concurrent/replayed webhooks do not duplicate state', async () => {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret_aetheon';
    const eventId = `evt_test_${Date.now()}`;
    const paymentId = `pay_${Date.now()}`;
    const orderId = `order_test_${Date.now()}`;

    // Seed local checkout session for authoritative mapping
    await adminClient.from('billing_checkout_sessions').insert({
      provider_reference: orderId,
      organisation_id: orgAId,
      site_id: siteAId,
      product_id: 'GRID_INTELLIGENCE',
      amount_paise: 1990000,
      provider_mode: 'MOCK_DEVELOPMENT',
      status: 'CREATED',
    });

    const payload = JSON.stringify({
      id: eventId,
      event: 'payment.captured',
      created_at: Math.floor(Date.now() / 1000),
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: orderId,
            amount: 1990000,
            notes: {
              org_id: orgAId,
              product_id: 'GRID_INTELLIGENCE',
            },
          },
        },
      },
    });

    const signature = CryptoJS.HmacSHA256(payload, webhookSecret).toString(CryptoJS.enc.Hex);

    // 1st Webhook Post
    const req1 = new NextRequest('http://localhost:3000/api/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': signature,
        'x-razorpay-event-id': eventId,
      },
      body: payload,
    });

    const res1 = await webhookPost(req1);
    expect(res1.status).toBe(200);
    const json1 = await res1.json();
    expect(json1.status).toBe('processed');

    // 2nd Webhook Post (Replay)
    const req2 = new NextRequest('http://localhost:3000/api/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': signature,
        'x-razorpay-event-id': eventId,
      },
      body: payload,
    });

    const res2 = await webhookPost(req2);
    expect(res2.status).toBe(200);
    const json2 = await res2.json();
    expect(json2.status).toBe('already_processed');
  });

  // 10. Operator cannot cancel subscription
  it('10. Billing Protection: OPERATOR cannot cancel subscriptions (403 INSUFFICIENT_ROLE)', async () => {
    const req = new NextRequest('http://localhost:3000/api/billing/cancel', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userBToken}`, // Operator Sunil Pawar
      },
      body: JSON.stringify({
        subscriptionId: subAId,
      }),
    });

    const res = await billingCancelPost(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('INSUFFICIENT_ROLE');
  });

  // 11. Adversarial Invitation Hijacking: User B cannot accept invitation bound to User A
  it('11. Invitation Email Binding: User B cannot accept token bound to a different email (403)', async () => {
    // Generate an invite token for userA
    const inviteToken = 'token_adv_' + Date.now();
    const tokenHash = CryptoJS.SHA256(inviteToken).toString(CryptoJS.enc.Hex);

    const { error: insErr } = await adminClient.from('organisation_invitations').insert({
      organisation_id: orgAId,
      email: 'intended.victim@demo.aetheonlabs.in',
      role: 'ENERGY_MANAGER',
      token_hash: tokenHash,
      token: inviteToken,
      invited_by: null,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      status: 'PENDING',
    });
    expect(insErr).toBeNull();

    // User B (Sunil Pawar - sunil.demo@demo.aetheonlabs.in) attempts to accept this invitation
    const req = new NextRequest('http://localhost:3000/api/invitations/accept', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userBToken}`,
      },
      body: JSON.stringify({
        token: inviteToken,
      }),
    });

    const res = await invitationAcceptPost(req);
    // Must be rejected with 403 Forbidden due to email mismatch
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain('different email address');
  });

  // 12. Direct RPC Lockdown: Customer cannot call process_razorpay_webhook_atomic directly
  it('12. Hard Security Blocker: Authenticated customer CANNOT invoke process_razorpay_webhook_atomic RPC directly (42501)', async () => {
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: `Bearer ${userAToken}`,
        },
      },
      auth: { persistSession: false },
    });

    const { data, error } = await userClient.rpc('process_razorpay_webhook_atomic', {
      p_event_id: 'evt_adversarial_direct_' + Date.now(),
      p_event_type: 'subscription.activated',
      p_payload: { malicious: true },
      p_org_id: orgAId,
      p_site_id: null,
      p_product_id: 'GRID_INTELLIGENCE',
      p_provider_ref: 'sub_fabricated_' + Date.now(),
      p_amount_paise: 0,
    });

    expect(data).toBeNull();
    expect(error).toBeDefined();
    // PostgreSQL permission denied error code 42501
    expect(error?.code).toBe('42501');
    expect(error?.message).toContain('permission denied for function process_razorpay_webhook_atomic');
  });

  // 13. Direct RPC Lockdown: Customer cannot call commit_ingestion_transaction directly
  it('13. Hard Security Blocker: Authenticated customer CANNOT invoke commit_ingestion_transaction RPC directly (42501)', async () => {
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: `Bearer ${userAToken}`,
        },
      },
      auth: { persistSession: false },
    });

    const { data, error } = await userClient.rpc('commit_ingestion_transaction', {
      p_site_id: siteAId,
      p_filename: 'adversarial_direct.csv',
      p_checksum_sha256: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      p_uploaded_by: 'c0000000-0000-0000-0000-000000000001',
      p_rows: [],
      p_freshness_status: 'FRESH',
      p_actor_role: 'SYSTEM',
      p_org_id: orgAId,
    });

    expect(data).toBeNull();
    expect(error).toBeDefined();
    expect(error?.code).toBe('42501');
    expect(error?.message).toContain('permission denied for function commit_ingestion_transaction');
  });

  // 14. Customer ORGANISATION_ADMIN cannot access internal platform admin audit API
  it('14. Customer vs Platform Admin: ORGANISATION_ADMIN cannot access /api/admin/audit (403)', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/audit', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${userAToken}`, // Rajesh Sharma: ORGANISATION_ADMIN
      },
    });

    const res = await adminAuditGet(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain('Customer Organisation Admins are not permitted platform administration access');
  });

  // 15. Expired Aetheon Analyst support access is denied
  it('15. Analyst Expiry Enforcement: Expired AETHEON_ANALYST is denied platform admin access (403)', async () => {
    // Create an expired analyst user session
    const expiredAnalystEmail = `expired.analyst.${Date.now()}@aetheon.energy`;
    const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
      email: expiredAnalystEmail,
      password: 'AnalystPassword123!',
      email_confirm: true,
    });
    expect(createErr).toBeNull();
    const analystId = newUser.user.id;

    // Set membership to AETHEON_ANALYST with past expires_at
    await adminClient.from('memberships').insert({
      organisation_id: orgAId,
      user_id: analystId,
      role: 'AETHEON_ANALYST',
      is_active: true,
      expires_at: new Date(Date.now() - 3600000).toISOString(), // 1 hour in past
    });

    // Sign in as expired analyst
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
    const { data: authData } = await client.auth.signInWithPassword({
      email: expiredAnalystEmail,
      password: 'AnalystPassword123!',
    });
    const expiredToken = authData.session!.access_token;

    const req = new NextRequest('http://localhost:3000/api/admin/audit', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${expiredToken}`,
      },
    });

    const res = await adminAuditGet(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain('Forbidden');

    // Clean up
    await adminClient.auth.admin.deleteUser(analystId);
  });

  // 16. Entitlement Uniqueness with NULL site_id (UNIQUE NULLS NOT DISTINCT)
  it('16. Entitlement Uniqueness: Duplicate org-wide entitlement with site_id = NULL is strictly rejected', async () => {
    const testProd = 'DSM_RISK';
    // Clean any pre-existing
    await adminClient.from('entitlements').delete().match({
      organisation_id: orgAId,
      product_id: testProd,
    });

    // 1st insertion: org-wide entitlement
    const { error: ins1Err } = await adminClient.from('entitlements').insert({
      organisation_id: orgAId,
      product_id: testProd,
      site_id: null,
      is_active: true,
    });
    expect(ins1Err).toBeNull();

    // 2nd insertion: duplicate org-wide entitlement with site_id = NULL
    const { error: ins2Err } = await adminClient.from('entitlements').insert({
      organisation_id: orgAId,
      product_id: testProd,
      site_id: null,
      is_active: true,
    });

    expect(ins2Err).toBeDefined();
    // Unique violation code 23505
    expect(ins2Err?.code).toBe('23505');
  });

  // 17. Analyst Expiry Write-Time Enforcement
  it('17. Write-Time Constraint: AETHEON_ANALYST with NULL expiry or expiry > 24 hours is rejected by trigger', async () => {
    const dummyAnalystEmail = `test.analyst.${Date.now()}@example.com`;
    const { data: newUser } = await adminClient.auth.admin.createUser({
      email: dummyAnalystEmail,
      password: 'AnalystPassword123!',
      email_confirm: true,
    });
    const analystId = newUser.user.id;

    // A. NULL expiry must be rejected
    const { error: nullExpiryErr } = await adminClient.from('memberships').insert({
      organisation_id: orgAId,
      user_id: analystId,
      role: 'AETHEON_ANALYST',
      is_active: true,
      expires_at: null,
    });
    expect(nullExpiryErr).toBeDefined();
    expect(nullExpiryErr?.message).toContain('specify an explicit expires_at');

    // B. Expiry > 24 hours must be rejected
    const { error: longExpiryErr } = await adminClient.from('memberships').insert({
      organisation_id: orgAId,
      user_id: analystId,
      role: 'AETHEON_ANALYST',
      is_active: true,
      expires_at: new Date(Date.now() + 25 * 3600 * 1000).toISOString(), // 25 hours
    });
    expect(longExpiryErr).toBeDefined();
    expect(longExpiryErr?.message).toContain('cannot exceed 24 hours');

    await adminClient.auth.admin.deleteUser(analystId);
  });

  // 18. Compliance API Approval Gate Enforcement
  it('18. Compliance Approval Gate: Customer API returns APPROVED charge and suppresses REVIEW_PENDING charge', async () => {
    // Ensure orgA has OA_COMPLIANCE entitlement for test
    await adminClient.from('entitlements').upsert({
      organisation_id: orgAId,
      product_id: 'OA_COMPLIANCE',
      site_id: siteAId,
      is_active: true,
    }, { onConflict: 'organisation_id,product_id,site_id' });

    // Insert REVIEW_PENDING source with higher/newer charges and APPROVED source with valid charges
    const pendingSourceId = 'd0000000-0000-0000-0000-000000000099';
    const approvedSourceId = 'd0000000-0000-0000-0000-000000000098';

    const { error: srcErr } = await adminClient.from('regulatory_sources').upsert([
      {
        id: pendingSourceId,
        jurisdiction: 'SERC',
        state: 'Maharashtra',
        document_title: 'Draft Unapproved Tariff Order 2026',
        document_date: '2026-01-01',
        effective_date: '2026-01-01',
        version: '1.0',
        status: 'REVIEW_PENDING',
        is_demo: false,
      },
      {
        id: approvedSourceId,
        jurisdiction: 'SERC',
        state: 'Maharashtra',
        document_title: 'Approved Multi-Year Tariff Order 2026',
        document_date: '2026-01-01',
        effective_date: '2026-01-01',
        version: '1.0',
        status: 'APPROVED',
        is_demo: false,
      },
    ]);
    expect(srcErr).toBeNull();

    // Insert open access charges with valid column names
    const { error: insErr } = await adminClient.from('open_access_charges').insert([
      {
        regulatory_source_id: pendingSourceId,
        state: 'Maharashtra',
        discom: 'MSEDCL',
        voltage_category: '33kV',
        effective_from: '2026-06-01',
        cross_subsidy_surcharge_inr_per_kwh: 9.99, // Bogus pending charge
        additional_surcharge_inr_per_kwh: 0.50,
        wheeling_charge_inr_per_kwh: 4.50,
        transmission_charge_inr_per_kwh: 0.80,
        banking_charge_pct: 5.0,
        is_demo: false,
      },
      {
        regulatory_source_id: approvedSourceId,
        state: 'Maharashtra',
        discom: 'MSEDCL',
        voltage_category: '33kV',
        effective_from: '2026-01-01',
        cross_subsidy_surcharge_inr_per_kwh: 1.85, // True approved charge
        additional_surcharge_inr_per_kwh: 0.50,
        wheeling_charge_inr_per_kwh: 1.15,
        transmission_charge_inr_per_kwh: 0.40,
        banking_charge_pct: 5.0,
        is_demo: false,
      },
    ]);
    expect(insErr).toBeNull();

    const req = new NextRequest(`http://localhost:3000/api/compliance?siteId=${siteAId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${userAToken}`,
      },
    });

    const res = await complianceGet(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.charges).toBeDefined();
    // Must return the APPROVED charge, never the REVIEW_PENDING 9.99 charge
    expect(Number(json.charges.cross_subsidy_surcharge_inr_per_kwh)).toBe(1.85);
    expect(Number(json.charges.cross_subsidy_surcharge_inr_per_kwh)).not.toBe(9.99);

    // Clean up
    await adminClient.from('open_access_charges').delete().match({ regulatory_source_id: pendingSourceId });
    await adminClient.from('open_access_charges').delete().match({ regulatory_source_id: approvedSourceId });
    await adminClient.from('regulatory_sources').delete().match({ id: pendingSourceId });
    await adminClient.from('regulatory_sources').delete().match({ id: approvedSourceId });
  });

  // 19. Webhook Unmapped Provider Reference Hardening
  it('19. Webhook Hardening: Unmapped provider reference is rejected even with valid signature', async () => {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret_aetheon';
    const rawPayload = JSON.stringify({
      event: 'order.paid',
      payload: {
        payment: {
          entity: {
            id: 'pay_unmapped_test_999',
            order_id: 'order_nonexistent_reference_123',
            amount: 2490000,
            status: 'captured',
            notes: { org_id: orgAId, site_id: siteAId, product_id: 'DSM_RISK' },
          },
        },
      },
    });

    const signature = CryptoJS.HmacSHA256(rawPayload, webhookSecret).toString(CryptoJS.enc.Hex);

    const req = new NextRequest('http://localhost:3000/api/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'x-razorpay-signature': signature,
        'Content-Type': 'application/json',
      },
      body: rawPayload,
    });

    const res = await webhookPost(req);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('DATABASE_TRANSACTION_FAILED');
    expect(json.details).toContain('Unknown provider reference');
  });

  // 20. Grid Forecast Run -> Report with exact 96 blocks via run_id
  it('20. Grid Report: Generates report with exact 96 persisted blocks matching run_id', async () => {
    const testDate = '2026-09-08';
    // Clean any prior forecast run for this site and date
    await adminClient.from('grid_forecast_runs').delete().match({ site_id: siteAId, operating_date: testDate });

    // Create a mock grid_forecast_run and 96 grid_forecast_blocks
    const { data: forecastRun, error: runErr } = await adminClient
      .from('grid_forecast_runs')
      .insert({
        site_id: siteAId,
        operating_date: testDate,
        model_version: 'GRID_INTEL_v1.0.4',
        quality_status: 'PASSED',
        average_price_inr_per_mwh: 4620.50,
        peak_demand_kw: 1420.5,
        peak_demand_block: 45,
      })
      .select('id')
      .single();

    expect(runErr).toBeNull();
    const runId = forecastRun.id;

    // Insert 96 blocks with run_id
    const blocks = Array.from({ length: 96 }, (_, i) => ({
      run_id: runId,
      block_index: i + 1,
      start_time: `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`,
      end_time: `${String(Math.floor((i + 1) / 4)).padStart(2, '0')}:${String(((i + 1) % 4) * 15).padStart(2, '0')}`,
      forecast_demand_kw: 1200 + i * 2,
      forecast_price_inr_per_mwh: 4500 + i * 10,
      confidence_lower_kw: 1100,
      confidence_upper_kw: 1300,
      is_high_cost_window: i >= 72 && i <= 88,
    }));

    const { error: blockErr } = await adminClient.from('grid_forecast_blocks').insert(blocks);
    expect(blockErr).toBeNull();

    // Generate report
    const req = new NextRequest('http://localhost:3000/api/reports/generate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userAToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        siteId: siteAId,
        module: 'GRID_INTELLIGENCE',
        reportType: 'DAILY_DISPATCH',
        periodStart: testDate,
        periodEnd: testDate,
      }),
    });

    const res = await reportsGeneratePost(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.report).toBeDefined();
    expect(json.report.id).toBeDefined();
    expect(json.report.download_url).toBe(`/api/reports/${json.report.id}/download`);

    // Download generated report
    const dlReq = new NextRequest(`http://localhost:3000/api/reports/${json.report.id}/download`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${userAToken}`,
      },
    });

    const dlRes = await reportsDownloadGet(dlReq, { params: { id: json.report.id } });
    expect(dlRes.status).toBe(200);
    const csvContent = await dlRes.text();
    // CSV must contain the model version and 96 data rows
    expect(csvContent).toContain('GRID_INTEL_v1.0.4');
    expect(csvContent).toContain(`RUN ID: ${runId}`);
    const dataLines = csvContent.split('\n').filter(line => line.startsWith(testDate));
    expect(dataLines.length).toBe(96);
  });

  // 26. Database Ingestion RPC Consistency: pg_proc has exactly ONE commit_ingestion_transaction
  it('26. Database Ingestion RPC Consistency: pg_proc has exactly ONE commit_ingestion_transaction with 8 args', async () => {
    const { data: signatures, error } = await adminClient.rpc('get_commit_ingestion_transaction_signatures');
    expect(error).toBeNull();
    expect(signatures).toBeDefined();
    expect(signatures.length).toBe(1);
    expect(signatures[0].proname).toBe('commit_ingestion_transaction');
    expect(signatures[0].pronargs).toBe(8);
  });

  // 27. Ingestion service_role call: first valid fresh day -> CALIBRATING (not ACTIVE)
  it('27. Ingestion State Machine: First valid day transitions site to CALIBRATING, not ACTIVE', async () => {
    const { data: newSite, error: siteErr } = await adminClient
      .from('sites')
      .insert({
        organisation_id: orgAId,
        name: `Calibration Test Site ${Date.now()}`,
        state: 'Maharashtra',
        discom: 'MSEDCL',
        voltage_category: '33kV',
        contract_demand_value: 1000,
        metering_point: 'Main Incomer Feeder',
        activation_status: 'CONFIGURED',
      })
      .select()
      .single();

    expect(siteErr).toBeNull();

    const opDate = '2026-09-01';
    const testRows = Array.from({ length: 96 }, (_, i) => ({
      block_index: i + 1,
      operating_date: opDate,
      actual_drawal_kw: 500 + (i % 10) * 10,
      scheduled_drawal_kw: 500,
      frequency_hz: 50.0,
      voltage_v: 33000,
      power_factor: 0.98,
      source_amr_status: 'VALID',
    }));

    const { data: commitRes, error: commitErr } = await adminClient.rpc('commit_ingestion_transaction', {
      p_site_id: newSite.id,
      p_filename: 'calibration_day1.csv',
      p_checksum_sha256: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      p_uploaded_by: 'c0000000-0000-0000-0000-000000000001',
      p_rows: testRows,
      p_freshness_status: 'RECENT',
      p_actor_role: 'SYSTEM',
      p_org_id: orgAId,
    });

    expect(commitErr).toBeNull();
    expect(commitRes.success).toBe(true);
    expect(commitRes.activation_status).toBe('CALIBRATING');

    const { data: updatedSite } = await adminClient
      .from('sites')
      .select('activation_status')
      .eq('id', newSite.id)
      .single();

    expect(updatedSite.activation_status).toBe('CALIBRATING');
  });

  // 28. Billing payment.failed transaction succeeds and inserts invoice with status FAILED without constraint error
  it('28. Billing payment.failed: Webhook transaction safely records FAILED status without CHECK violation', async () => {
    const eventId = `evt_fail_${Date.now()}`;
    const orderId = `order_fail_${Date.now()}`;

    await adminClient.from('billing_checkout_sessions').insert({
      provider_reference: orderId,
      organisation_id: orgAId,
      product_id: 'GRID_INTELLIGENCE',
      amount_paise: 1990000,
      provider_mode: 'RAZORPAY_TEST',
      status: 'CREATED',
    });

    const { data: webhookRes, error: webhookErr } = await adminClient.rpc('process_razorpay_webhook_atomic', {
      p_event_id: eventId,
      p_event_type: 'payment.failed',
      p_payload: { order_id: orderId, reason: 'card_declined' },
      p_org_id: orgAId,
      p_site_id: null,
      p_product_id: 'GRID_INTELLIGENCE',
      p_provider_ref: orderId,
      p_amount_paise: 1990000,
    });

    expect(webhookErr).toBeNull();
    expect(webhookRes.success).toBe(true);

    const { data: invoice } = await adminClient
      .from('invoices')
      .select('status, amount_paise')
      .eq('organisation_id', orgAId)
      .eq('status', 'FAILED')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    expect(invoice).toBeDefined();
    expect(invoice.status).toBe('FAILED');
    expect(invoice.amount_paise).toBe(1990000);
  });

  // 29. DSM Null/Missing data: POST /api/dsm with null values returns MISSING_DATA and suppresses exposure
  it('29. DSM Missing Data Safety: Rejects null scheduled/actual values and suppresses exposure (MISSING_DATA)', async () => {
    const scheduledWithNull = Array.from({ length: 96 }, (_, i) => (i === 10 ? null : 1000));
    const actualValid = Array.from({ length: 96 }, () => 1050);

    const req = new NextRequest('http://localhost:3000/api/dsm', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userAToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        siteId: siteAId,
        operatingDate: '2026-09-02',
        scheduledDrawalKw: scheduledWithNull,
        actualDrawalKw: actualValid,
        contractDemandKw: 1000,
      }),
    });

    const res = await dsmPost(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.is_suppressed).toBe(true);
    expect(json.suppression_reason).toContain('MISSING_DATA');
    expect(json.summary.estimated_penalty_inr).toBe(0);
  });

  // 30. DSM Idempotency: POSTing same DSM calculation twice produces no duplicate incidents
  it('30. DSM Idempotency: Re-evaluating identical DSM parameters produces no duplicate incidents in dsm_incidents', async () => {
    const dsmDate = `2026-09-${(Date.now() % 28 + 1).toString().padStart(2, '0')}`;
    const scheduled = Array.from({ length: 96 }, () => 1000);
    const actual = Array.from({ length: 96 }, (_, i) => (i >= 50 && i <= 55 ? 1300 : 1000));

    const makeReq = () => new NextRequest('http://localhost:3000/api/dsm', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userAToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        siteId: siteAId,
        operatingDate: dsmDate,
        scheduledDrawalKw: scheduled,
        actualDrawalKw: actual,
        contractDemandKw: 1000,
      }),
    });

    const res1 = await dsmPost(makeReq());
    expect(res1.status).toBe(200);
    const json1 = await res1.json();
    expect(json1.incidents).toBeDefined();

    const initialIncidentCount = json1.incidents.length;

    const res2 = await dsmPost(makeReq());
    expect(res2.status).toBe(200);

    const { data: dbIncidents } = await adminClient
      .from('dsm_incidents')
      .select('id, start_block, end_block')
      .eq('site_id', siteAId)
      .eq('operating_date', dsmDate);

    expect(dbIncidents.length).toBe(initialIncidentCount);
  });

  // 31. Reports: Unknown report type -> 400 INVALID_REPORT_TYPE
  it('31. Report Contract Safety: Rejects unknown reportType with HTTP 400 INVALID_REPORT_TYPE', async () => {
    const req = new NextRequest('http://localhost:3000/api/reports/generate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userAToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        siteId: siteAId,
        reportType: 'TOTALLY_UNKNOWN_REPORT_TYPE',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-01',
      }),
    });

    const res = await reportsGeneratePost(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('INVALID_REPORT_TYPE');
  });

  // 32. Reports: Entitlement check on download (unentitled user/module rejected with 403)
  it('32. Report Download Entitlement: Download route rejects access if organisation lacks module entitlement (403)', async () => {
    const { data: rep } = await adminClient
      .from('report_records')
      .insert({
        organisation_id: orgBId,
        site_id: siteBId,
        module: 'BESS',
        report_type: 'BESS_PERFORMANCE_REPORT',
        period_start: '2026-09-01',
        period_end: '2026-09-01',
        title: 'Unauthorized BESS Report',
        summary: { sample: 1 },
        quality_status: 'PASSED',
        model_version: 'v1.0',
        tariff_version: 'v1.0',
        rule_version: 'v1.0',
        download_url: '/api/reports/placeholder/download',
      })
      .select()
      .single();

    const req = new NextRequest(`http://localhost:3000/api/reports/${rep.id}/download`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${userAToken}`,
      },
    });

    const res = await reportsDownloadGet(req, { params: { id: rep.id } });
    expect(res.status).toBe(403);
  });

  // 33. Compliance: Approved source resolver requires exact voltage category (no fallback to wrong voltage)
  it('33. Compliance Regulatory Gate: Resolver requires exact voltage match and returns DATA GAP when no matching tariff exists', async () => {
    const req = new NextRequest(`http://localhost:3000/api/compliance?siteId=${siteAId}&state=Goa&discom=UNKNOWN_DISCOM&voltageCategory=400kV`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${userAToken}`,
      },
    });

    const res = await complianceGet(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.charges).toBeNull();
    expect(json.is_data_gap).toBe(true);
  });

  // 34. Server-Authoritative Quality Gate: Live site in CALIBRATING status suppresses operational forecast
  it('34. Quality Gate Server Authority: Live site without active calibrated baseline is suppressed by server', async () => {
    const { data: uncalibratedSite } = await adminClient
      .from('sites')
      .insert({
        organisation_id: orgAId,
        name: `Uncalibrated Live Site ${Date.now()}`,
        state: 'Maharashtra',
        discom: 'MSEDCL',
        voltage_category: '33kV',
        contract_demand_value: 1000,
        metering_point: 'Main Incomer',
        activation_status: 'CALIBRATING',
        is_demo: false,
      })
      .select()
      .single();

    await adminClient.from('site_access').insert({
      site_id: uncalibratedSite.id,
      user_id: 'c0000000-0000-0000-0000-000000000001',
    });

    const req = new NextRequest(`http://localhost:3000/api/forecast?siteId=${uncalibratedSite.id}&operatingDate=2026-09-05`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${userAToken}`,
      },
    });

    const res = await forecastGet(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.is_suppressed).toBe(true);
    expect(json.suppression_reason).toContain('CALIBRATING');
    expect(json.blocks).toHaveLength(0);
    expect(json.persisted).toBe(false);
  });
});

