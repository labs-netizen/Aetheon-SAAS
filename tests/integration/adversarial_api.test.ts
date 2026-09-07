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
        operatingDate: '2026-09-08',
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
    // Generate valid 96 blocks
    const parsedBlocks = [];
    for (let b = 1; b <= 96; b++) {
      parsedBlocks.push({
        operating_date: '2026-09-08',
        block_index: b,
        start_time: '00:00',
        end_time: '00:15',
        load_kw: 250.0,
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
  });

  // 9. Repeated Webhook Replay Atomicity
  it('9. Webhook Idempotency: Concurrent/replayed webhooks do not duplicate state', async () => {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret_aetheon';
    const eventId = `evt_test_${Date.now()}`;
    const payload = JSON.stringify({
      id: eventId,
      event: 'payment.captured',
      created_at: Math.floor(Date.now() / 1000),
      payload: {
        payment: {
          entity: {
            id: `pay_${Date.now()}`,
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
});
