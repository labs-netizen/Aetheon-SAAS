/**
 * Surgical Fixes Test Suite (Items 1, 5, 6, 8, 9, 16)
 * Authoritative verification of:
 * - Exact V1 CSV contract (RPC + API)
 * - Fail-closed Grid report generation
 * - DSM evaluation-run proof (zero incidents vs data gap)
 * - Billing first-payment schema & brand-new org provisioning
 * - Durable webhook quarantine without rollback
 * - Live BESS solver pipeline, signal run persistence & report generation
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import CryptoJS from 'crypto-js';

import { POST as ingestionCommitPost } from '@/app/api/ingestion/commit/route';
import { POST as reportsGeneratePost } from '@/app/api/reports/generate/route';
import { POST as dsmPost } from '@/app/api/dsm/route';
import { POST as webhookPost } from '@/app/api/webhooks/razorpay/route';
import { POST as bessPost } from '@/app/api/bess/route';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:15431';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

describe('Surgical Fixes & Canonical Invariants Suite', () => {
  let adminClient: any;
  let anonClient: any;
  let nonDemoUserToken: string;
  const nonDemoOrgId = 'a0000000-0000-0000-0000-000000000002';
  const nonDemoSiteId = 'b0000000-0000-0000-0000-000000000010';
  const nonDemoBatteryId = 'e0000000-0000-0000-0000-000000000010';

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: auth, error } = await anonClient.auth.signInWithPassword({
      email: 'alok.nondemo@kalyanibharat.com',
      password: 'AetheonLive2026!',
    });
    if (error) {
      console.error('Non-demo auth sign-in error:', error);
    }
    expect(auth?.session?.access_token).toBeDefined();
    nonDemoUserToken = auth.session!.access_token;
  });

  // =========================================================================
  // ITEM 1: EXACT V1 CSV CONTRACT (API & RPC)
  // =========================================================================
  describe('1. Exact V1 CSV Contract Enforcement', () => {
    it('rejects non-96 rows in commit_ingestion_transaction RPC', async () => {
      // Test 95 rows via RPC directly
      const rows95: any[] = [];
      for (let b = 1; b <= 95; b++) {
        rows95.push({
          operating_date: '2026-09-08',
          block_index: b,
          start_time: '00:00',
          end_time: '00:15',
          load_kw: 1000,
        });
      }

      const { error } = await adminClient.rpc('commit_ingestion_transaction', {
        p_site_id: nonDemoSiteId,
        p_filename: `test_95_${Date.now()}.csv`,
        p_checksum_sha256: `test_chk_95_${Date.now()}`.padEnd(64, '0'),
        p_uploaded_by: 'c0000000-0000-0000-0000-000000000010',
        p_rows: rows95,
        p_freshness_status: 'RECENT',
        p_actor_role: 'ORGANISATION_ADMIN',
        p_org_id: nonDemoOrgId,
      });

      expect(error).not.toBeNull();
      expect(error.message).toContain('EXACTLY 96');
    });

    it('rejects multiple operating dates in commit_ingestion_transaction RPC', async () => {
      const multiDateRows: any[] = [];
      for (let b = 1; b <= 96; b++) {
        multiDateRows.push({
          operating_date: b <= 48 ? '2026-09-08' : '2026-09-09',
          block_index: b,
          start_time: '00:00',
          end_time: '00:15',
          load_kw: 1000,
        });
      }

      const { error } = await adminClient.rpc('commit_ingestion_transaction', {
        p_site_id: nonDemoSiteId,
        p_filename: `test_multi_${Date.now()}.csv`,
        p_checksum_sha256: `test_chk_multi_${Date.now()}`.padEnd(64, '0'),
        p_uploaded_by: 'c0000000-0000-0000-0000-000000000010',
        p_rows: multiDateRows,
        p_freshness_status: 'RECENT',
        p_actor_role: 'ORGANISATION_ADMIN',
        p_org_id: nonDemoOrgId,
      });

      expect(error).not.toBeNull();
      expect(error.message).toContain('one operating date permitted');
    });

    it('rejects duplicate blocks in commit_ingestion_transaction RPC', async () => {
      const dupRows: any[] = [];
      for (let b = 1; b <= 96; b++) {
        dupRows.push({
          operating_date: '2026-09-08',
          block_index: b === 50 ? 49 : b,
          start_time: '00:00',
          end_time: '00:15',
          load_kw: 1000,
        });
      }

      const { error } = await adminClient.rpc('commit_ingestion_transaction', {
        p_site_id: nonDemoSiteId,
        p_filename: `test_dup_${Date.now()}.csv`,
        p_checksum_sha256: `test_chk_dup_${Date.now()}`.padEnd(64, '0'),
        p_uploaded_by: 'c0000000-0000-0000-0000-000000000010',
        p_rows: dupRows,
        p_freshness_status: 'RECENT',
        p_actor_role: 'ORGANISATION_ADMIN',
        p_org_id: nonDemoOrgId,
      });

      expect(error).not.toBeNull();
      expect(error.message).toContain('contiguous 1 to 96');
    });

    it('API commit endpoint rejects 95 rows and impossible calendar date 2026-02-31', async () => {
      // 95 rows via API
      const rows95 = ['operating_date,block_index,start_time,end_time,load_kw'];
      for (let b = 1; b <= 95; b++) {
        rows95.push(`2026-09-08,${b},00:00,00:15,1000`);
      }

      const req95 = new NextRequest('http://localhost:3000/api/ingestion/commit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${nonDemoUserToken}`,
        },
        body: JSON.stringify({
          siteId: nonDemoSiteId,
          filename: 'test95.csv',
          csvText: rows95.join('\n'),
        }),
      });
      const res95 = await ingestionCommitPost(req95);
      expect(res95.status).toBe(422);
      const json95 = await res95.json();
      expect(json95.error).toBe('CSV_PARSING_FAILED');

      // Impossible calendar date 2026-02-31
      const badDateRows = ['operating_date,block_index,start_time,end_time,load_kw'];
      for (let b = 1; b <= 96; b++) {
        badDateRows.push(`2026-02-31,${b},00:00,00:15,1000`);
      }

      const reqBad = new NextRequest('http://localhost:3000/api/ingestion/commit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${nonDemoUserToken}`,
        },
        body: JSON.stringify({
          siteId: nonDemoSiteId,
          filename: 'bad_date.csv',
          csvText: badDateRows.join('\n'),
        }),
      });
      const resBad = await ingestionCommitPost(reqBad);
      expect(resBad.status).toBe(422);
    });

    it('guarantees invariant: validation_status = FAILED cannot yield PUBLISHABLE in ingestion_log', async () => {
      const { data: invalidLogs } = await adminClient
        .from('ingestion_log')
        .select('*')
        .eq('validation_status', 'FAILED')
        .eq('publication_gate_status', 'PUBLISHABLE');

      expect(invalidLogs || []).toHaveLength(0);
    });
  });

  // =========================================================================
  // ITEM 5: GRID REPORT GENERATION FAILS CLOSED
  // =========================================================================
  describe('5. Fail-Closed Grid Report Generation', () => {
    it('rejects report generation when forecast has non-96 blocks or missing quality', async () => {
      const testDate = '2026-09-20';
      // Create a test run with only 95 blocks
      const { data: run, error: runErr } = await adminClient
        .from('grid_forecast_runs')
        .upsert(
          {
            site_id: nonDemoSiteId,
            operating_date: testDate,
            peak_demand_kw: 2500,
            peak_demand_block: 50,
            average_price_inr_per_mwh: 4200,
            quality_status: 'PASSED',
            freshness_status: 'RECENT',
          },
          { onConflict: 'site_id,operating_date' }
        )
        .select()
        .single();
      expect(runErr).toBeNull();

      // Insert only 95 blocks
      const blocks95 = [];
      for (let b = 1; b <= 95; b++) {
        blocks95.push({
          run_id: run.id,
          block_index: b,
          start_time: '00:00',
          end_time: '00:15',
          forecast_demand_kw: 2000,
          forecast_price_inr_per_mwh: 4000,
          confidence_lower_kw: 1800,
          confidence_upper_kw: 2200,
        });
      }
      await adminClient.from('grid_forecast_blocks').delete().eq('run_id', run.id);
      await adminClient.from('grid_forecast_blocks').insert(blocks95);

      const req = new NextRequest('http://localhost:3000/api/reports/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${nonDemoUserToken}`,
        },
        body: JSON.stringify({
          siteId: nonDemoSiteId,
          reportType: 'GRID_DAILY_BRIEF',
          periodStart: testDate,
          periodEnd: testDate,
        }),
      });

      const res = await reportsGeneratePost(req);
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error).toBe('REPORT_NOT_PUBLISHABLE');
      expect(json.reason).toBe('DATA_GAP');
    });

    it('rejects report generation when quality status is BLOCKED or missing', async () => {
      const testDate = '2026-09-21';
      // Create run with 96 blocks
      const { data: run } = await adminClient
        .from('grid_forecast_runs')
        .upsert(
          {
            site_id: nonDemoSiteId,
            operating_date: testDate,
            peak_demand_kw: 2500,
            peak_demand_block: 50,
            average_price_inr_per_mwh: 4200,
            quality_status: 'PASSED',
            freshness_status: 'RECENT',
          },
          { onConflict: 'site_id,operating_date' }
        )
        .select()
        .single();

      const blocks96 = [];
      for (let b = 1; b <= 96; b++) {
        blocks96.push({
          run_id: run.id,
          block_index: b,
          start_time: '00:00',
          end_time: '00:15',
          forecast_demand_kw: 2000,
          forecast_price_inr_per_mwh: 4000,
          confidence_lower_kw: 1800,
          confidence_upper_kw: 2200,
        });
      }
      await adminClient.from('grid_forecast_blocks').delete().eq('run_id', run.id);
      await adminClient.from('grid_forecast_blocks').insert(blocks96);

      // Insert data quality evaluation with BLOCKED status
      await adminClient.from('data_quality_evaluations').upsert({
        site_id: nonDemoSiteId,
        evaluation_date: testDate,
        completeness_pct: 90.0,
        missing_blocks_count: 6,
        freshness_status: 'RECENT',
        validation_status: 'FAILED',
        publication_gate_status: 'BLOCKED_MISSING_INPUT',
      });

      const req = new NextRequest('http://localhost:3000/api/reports/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${nonDemoUserToken}`,
        },
        body: JSON.stringify({
          siteId: nonDemoSiteId,
          reportType: 'GRID_DAILY_BRIEF',
          periodStart: testDate,
          periodEnd: testDate,
        }),
      });

      const res = await reportsGeneratePost(req);
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error).toBe('REPORT_NOT_PUBLISHABLE');
      expect(json.reason).toContain('QUALITY_GATE');
    });

    it('successfully generates report when run has 96 blocks and PUBLISHABLE quality', async () => {
      const testDate = '2026-09-22';
      const { data: run } = await adminClient
        .from('grid_forecast_runs')
        .upsert(
          {
            site_id: nonDemoSiteId,
            operating_date: testDate,
            peak_demand_kw: 2500,
            peak_demand_block: 50,
            average_price_inr_per_mwh: 4200,
            quality_status: 'PASSED',
            freshness_status: 'RECENT',
          },
          { onConflict: 'site_id,operating_date' }
        )
        .select()
        .single();

      const blocks96 = [];
      for (let b = 1; b <= 96; b++) {
        blocks96.push({
          run_id: run.id,
          block_index: b,
          start_time: '00:00',
          end_time: '00:15',
          forecast_demand_kw: 2000,
          forecast_price_inr_per_mwh: 4000,
          confidence_lower_kw: 1800,
          confidence_upper_kw: 2200,
        });
      }
      await adminClient.from('grid_forecast_blocks').delete().eq('run_id', run.id);
      await adminClient.from('grid_forecast_blocks').insert(blocks96);

      await adminClient.from('data_quality_evaluations').upsert({
        site_id: nonDemoSiteId,
        evaluation_date: testDate,
        completeness_pct: 100.0,
        missing_blocks_count: 0,
        freshness_status: 'RECENT',
        validation_status: 'PASSED',
        publication_gate_status: 'PUBLISHABLE',
      });

      const req = new NextRequest('http://localhost:3000/api/reports/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${nonDemoUserToken}`,
        },
        body: JSON.stringify({
          siteId: nonDemoSiteId,
          reportType: 'GRID_DAILY_BRIEF',
          periodStart: testDate,
          periodEnd: testDate,
        }),
      });

      const res = await reportsGeneratePost(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.reportId).toBeDefined();
    });
  });

  // =========================================================================
  // ITEM 6: DSM CALCULATION-RUN PROOF
  // =========================================================================
  describe('6. DSM Evaluation-Run Proof (Zero Incidents vs Data Gap)', () => {
    it('persists a dsm_evaluation_runs record when zero incidents are detected', async () => {
      const dsmDate = '2026-09-23';

      // Live site requires persisted 96 intervals in interval_data_96
      const intervalRows = [];
      for (let b = 1; b <= 96; b++) {
        intervalRows.push({
          site_id: nonDemoSiteId,
          operating_date: dsmDate,
          block_index: b,
          timestamp_utc: new Date(Date.parse(`${dsmDate}T00:00:00Z`) + (b - 1) * 15 * 60000).toISOString(),
          load_kw: 2000,
          scheduled_drawal_kw: 2000,
          actual_drawal_kw: 2000, // 0% deviation -> zero incidents
          data_quality: 'PASSED',
        });
      }
      await adminClient.from('interval_data_96').delete().eq('site_id', nonDemoSiteId).eq('operating_date', dsmDate);
      await adminClient.from('interval_data_96').insert(intervalRows);

      const req = new NextRequest('http://localhost:3000/api/dsm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${nonDemoUserToken}`,
        },
        body: JSON.stringify({
          siteId: nonDemoSiteId,
          operatingDate: dsmDate,
          contractDemandKw: 3000,
        }),
      });

      const res = await dsmPost(req);
      expect(res.status).toBe(200);
      const dsmResult = await res.json();
      expect(dsmResult.incidents).toHaveLength(0);

      // Verify row persisted in dsm_evaluation_runs
      const { data: runRecord } = await adminClient
        .from('dsm_evaluation_runs')
        .select('*')
        .eq('site_id', nonDemoSiteId)
        .eq('operating_date', dsmDate)
        .maybeSingle();

      expect(runRecord).not.toBeNull();
      expect(runRecord.result_status).toBe('NO_MATERIAL_INCIDENTS');
      expect(runRecord.rule_status).toBe('REGULATORY_CONFIGURATION_REQUIRED');

      // Now request DSM_MONTHLY_REVIEW report for this date -> must be NO_MATERIAL_INCIDENTS, NOT data gap
      const repReq = new NextRequest('http://localhost:3000/api/reports/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${nonDemoUserToken}`,
        },
        body: JSON.stringify({
          siteId: nonDemoSiteId,
          reportType: 'DSM_MONTHLY_REVIEW',
          periodStart: dsmDate,
          periodEnd: dsmDate,
        }),
      });

      const repRes = await reportsGeneratePost(repReq);
      expect(repRes.status).toBe(200);
      const repJson = await repRes.json();
      expect(repJson.success).toBe(true);

      // Check report CSV contents
      const { data: reportDoc } = await adminClient
        .from('report_records')
        .select('*')
        .eq('id', repJson.reportId)
        .single();
      expect(reportDoc.summary.status).toBe('NO_MATERIAL_INCIDENTS');
    });

    it('returns REPORT_DATA_GAP when no valid DSM evaluation run exists', async () => {
      const emptyPeriodStart = '2026-08-01';
      const emptyPeriodEnd = '2026-08-02';

      const repReq = new NextRequest('http://localhost:3000/api/reports/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${nonDemoUserToken}`,
        },
        body: JSON.stringify({
          siteId: nonDemoSiteId,
          reportType: 'DSM_MONTHLY_REVIEW',
          periodStart: emptyPeriodStart,
          periodEnd: emptyPeriodEnd,
        }),
      });

      const repRes = await reportsGeneratePost(repReq);
      expect(repRes.status).toBe(422);
      const repJson = await repRes.json();
      expect(repJson.error).toBe('REPORT_NOT_PUBLISHABLE');
      expect(repJson.reason).toBe('REPORT_DATA_GAP');
    });
  });

  // =========================================================================
  // ITEM 8: BILLING FIRST-PAYMENT SCHEMA & BRAND NEW ORG PROVISIONING
  // =========================================================================
  describe('8. Billing First-Payment Schema for Brand New Organisation', () => {
    it('proves checkout -> webhook -> new subscription -> subscription item -> entitlement -> invoice', async () => {
      // 1. Create a brand new organisation with no pre-existing subscriptions
      const brandNewOrgId = `a0000000-0000-0000-0000-${Date.now().toString(16).padStart(12, '0')}`.substring(0, 36);
      await adminClient.from('organisations').insert({
        id: brandNewOrgId,
        name: 'Brand New Industrial Org Ltd',
        legal_entity_name: 'Brand New Industrial Org Private Limited',
        gstin: '27AABCB9999F1Z1',
        is_active: true,
      });

      const orderId = `order_new_${Date.now()}`;
      const paymentId = `pay_new_${Date.now()}`;
      const secret = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret_aetheon';

      // 2. Insert authoritative checkout session record as produced by /api/billing/checkout
      await adminClient.from('billing_checkout_sessions').insert({
        organisation_id: brandNewOrgId,
        product_id: 'GRID_INTELLIGENCE',
        provider_reference: orderId,
        amount_paise: 1499900,
        provider_mode: 'RAZORPAY_TEST',
        status: 'CREATED',
      });

      const webhookPayload = {
        entity: 'event',
        event: 'payment.captured',
        contains: ['payment'],
        payload: {
          payment: {
            entity: {
              id: paymentId,
              order_id: orderId,
              amount: 1499900,
              currency: 'INR',
              status: 'captured',
              notes: {
                organisation_id: brandNewOrgId,
                product_ids: JSON.stringify(['GRID_INTELLIGENCE']),
              },
            },
          },
        },
      };

      const payloadStr = JSON.stringify(webhookPayload);
      const signature = CryptoJS.HmacSHA256(payloadStr, secret).toString(CryptoJS.enc.Hex);

      const req = new NextRequest('http://localhost:3000/api/webhooks/razorpay', {
        method: 'POST',
        headers: {
          'x-razorpay-signature': signature,
          'Content-Type': 'application/json',
        },
        body: payloadStr,
      });

      const res = await webhookPost(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe('processed');

      // Verify subscription created with billing_provider_ref = orderId (or paymentId)
      const { data: sub } = await adminClient
        .from('subscriptions')
        .select('*')
        .eq('organisation_id', brandNewOrgId)
        .maybeSingle();

      expect(sub).not.toBeNull();
      expect(sub.billing_provider_ref).toBe(orderId);
      expect(sub.status).toBe('ACTIVE');

      // Verify subscription item created
      const { data: items } = await adminClient
        .from('subscription_items')
        .select('*')
        .eq('subscription_id', sub.id);
      expect(items.length).toBeGreaterThan(0);

      // Verify entitlement granted
      const { data: ent } = await adminClient
        .from('entitlements')
        .select('*')
        .eq('organisation_id', brandNewOrgId)
        .eq('product_id', 'GRID_INTELLIGENCE')
        .maybeSingle();
      expect(ent).not.toBeNull();
      expect(ent.is_active).toBe(true);

      // Verify invoice created
      const { data: inv } = await adminClient
        .from('invoices')
        .select('*')
        .eq('organisation_id', brandNewOrgId)
        .maybeSingle();
      expect(inv).not.toBeNull();
      expect(inv.status).toBe('PAID');
      expect(inv.amount_paise).toBe(1499900);
    });
  });

  // =========================================================================
  // ITEM 9: DURABLE UNKNOWN WEBHOOK QUARANTINE
  // =========================================================================
  describe('9. Durable Webhook Quarantine (No Rollback)', () => {
    it('quarantines unknown provider reference durably without granting subscriptions', async () => {
      const secret = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret_aetheon';
      const unknownOrderId = `order_unknown_${Date.now()}`;
      const unknownPaymentId = `pay_unknown_${Date.now()}`;

      // Payload missing checkout session in local database
      const webhookPayload = {
        entity: 'event',
        event: 'payment.captured',
        contains: ['payment'],
        payload: {
          payment: {
            entity: {
              id: unknownPaymentId,
              order_id: unknownOrderId,
              amount: 500000,
              currency: 'INR',
              status: 'captured',
              notes: {
                organisation_id: '00000000-0000-0000-0000-000000000000',
              },
            },
          },
        },
      };

      const payloadStr = JSON.stringify(webhookPayload);
      const signature = CryptoJS.HmacSHA256(payloadStr, secret).toString(CryptoJS.enc.Hex);

      const req = new NextRequest('http://localhost:3000/api/webhooks/razorpay', {
        method: 'POST',
        headers: {
          'x-razorpay-signature': signature,
          'Content-Type': 'application/json',
        },
        body: payloadStr,
      });

      const res = await webhookPost(req);
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.status).toBe('quarantined');

      // Prove durable row exists in processed_webhook_events
      const { data: eventRecord } = await adminClient
        .from('processed_webhook_events')
        .select('*')
        .eq('id', unknownPaymentId)
        .maybeSingle();

      expect(eventRecord).not.toBeNull();
      expect(eventRecord.status).toBe('QUARANTINED');

      // Prove NO subscription or entitlement was created
      const { data: zeroSubs } = await adminClient
        .from('subscriptions')
        .select('*')
        .eq('billing_provider_ref', unknownOrderId);
      expect(zeroSubs).toHaveLength(0);
    });
  });

  // =========================================================================
  // ITEM 16: BESS LIVE SOLVER PATH, PERSISTENCE & REPORT GENERATION
  // =========================================================================
  describe('16. BESS Live Database Path & Performance Report', () => {
    const bessDate = '2026-09-24';

    beforeAll(async () => {
      // 1. Ensure fresh telemetry on non-demo BESS asset
      await adminClient
        .from('bess_assets')
        .update({
          current_soc_pct: 55.0,
          maintenance_lock: false,
          is_active: true,
          last_telemetry_at: new Date().toISOString(),
        })
        .eq('id', nonDemoBatteryId);

      // 2. Ensure persisted 96-block price curve exists for requested date
      const { data: run } = await adminClient
        .from('grid_forecast_runs')
        .upsert(
          {
            site_id: nonDemoSiteId,
            operating_date: bessDate,
            peak_demand_kw: 2500,
            peak_demand_block: 50,
            average_price_inr_per_mwh: 4500,
            quality_status: 'PASSED',
            freshness_status: 'RECENT',
          },
          { onConflict: 'site_id,operating_date' }
        )
        .select()
        .single();

      const blocks96 = [];
      for (let b = 1; b <= 96; b++) {
        // Night low (blocks 1-24), day peak (blocks 25-72), evening peak (blocks 73-96)
        const price = b <= 24 ? 2800 : b <= 72 ? 4500 : 7500;
        blocks96.push({
          run_id: run.id,
          block_index: b,
          start_time: '00:00',
          end_time: '00:15',
          forecast_demand_kw: 2000,
          forecast_price_inr_per_mwh: price,
          confidence_lower_kw: 1800,
          confidence_upper_kw: 2200,
        });
      }
      await adminClient.from('grid_forecast_blocks').delete().eq('run_id', run.id);
      await adminClient.from('grid_forecast_blocks').insert(blocks96);
    });

    it('executes live BESS solver without browser prices and persists bess_signal_runs', async () => {
      // POST without browser prices (server must resolve price curve and asset parameters)
      const req = new NextRequest('http://localhost:3000/api/bess', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${nonDemoUserToken}`,
        },
        body: JSON.stringify({
          siteId: nonDemoSiteId,
          operatingDate: bessDate,
        }),
      });

      const res = await bessPost(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.blocks).toHaveLength(96);
      expect(json.gross_arbitrage_inr).toBeGreaterThanOrEqual(0);

      // Verify run persisted in bess_signal_runs
      const { data: persistedRun } = await adminClient
        .from('bess_signal_runs')
        .select('*')
        .eq('battery_id', nonDemoBatteryId)
        .eq('operating_date', bessDate)
        .maybeSingle();

      expect(persistedRun).not.toBeNull();
      expect(persistedRun.gross_arbitrage_inr).toBe(json.gross_arbitrage_inr);
    });

    it('generates BESS_PERFORMANCE_REPORT from persisted schema', async () => {
      const repReq = new NextRequest('http://localhost:3000/api/reports/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${nonDemoUserToken}`,
        },
        body: JSON.stringify({
          siteId: nonDemoSiteId,
          reportType: 'BESS_PERFORMANCE_REPORT',
          periodStart: bessDate,
          periodEnd: bessDate,
        }),
      });

      const repRes = await reportsGeneratePost(repReq);
      expect(repRes.status).toBe(200);
      const repJson = await repRes.json();
      expect(repJson.success).toBe(true);
      expect(repJson.reportId).toBeDefined();

      const { data: reportDoc } = await adminClient
        .from('report_records')
        .select('*')
        .eq('id', repJson.reportId)
        .single();
      expect(reportDoc.summary.assetId).toBe(nonDemoBatteryId);
      expect(reportDoc.summary.solverVersion).toBeDefined();
    });

    it('suppresses safely when price curve is missing for requested date', async () => {
      const missingPriceDate = '2026-10-01';
      const req = new NextRequest('http://localhost:3000/api/bess', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${nonDemoUserToken}`,
        },
        body: JSON.stringify({
          siteId: nonDemoSiteId,
          operatingDate: missingPriceDate,
        }),
      });

      const res = await bessPost(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.is_suppressed).toBe(true);
      expect(json.suppression_reason).toContain('DATA_GAP');
    });

    it('suppresses safely when BESS asset telemetry is stale', async () => {
      // Set asset telemetry to 2 hours ago
      await adminClient
        .from('bess_assets')
        .update({
          last_telemetry_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
        })
        .eq('id', nonDemoBatteryId);

      const req = new NextRequest('http://localhost:3000/api/bess', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${nonDemoUserToken}`,
        },
        body: JSON.stringify({
          siteId: nonDemoSiteId,
          operatingDate: bessDate,
        }),
      });

      const res = await bessPost(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.is_suppressed).toBe(true);
      expect(json.suppression_reason).toContain('BMS telemetry is stale');

      // Restore fresh telemetry for subsequent tests
      await adminClient
        .from('bess_assets')
        .update({
          last_telemetry_at: new Date().toISOString(),
        })
        .eq('id', nonDemoBatteryId);
    });
  });
});
