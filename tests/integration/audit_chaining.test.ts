import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:15431';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is required for tests');
}

function formatPostgresJsonb(obj: any): string {
  if (!obj || Object.keys(obj).length === 0) return '{}';
  const sorted: Record<string, any> = {};
  for (const k of Object.keys(obj).sort()) {
    sorted[k] = obj[k];
  }
  return JSON.stringify(sorted).replace(/,/g, ', ').replace(/:/g, ': ');
}

function formatPostgresTimestamp(isoStr: string): string {
  return isoStr.replace('T', ' ').replace('+00:00', '+00');
}

describe('Audit Log Tamper-Evident Hash Chaining & Concurrency Tests', () => {
  let adminClient: any;
  let testOrgId: string;

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Create a temporary test organization
    const { data: org, error: orgErr } = await adminClient
      .from('organisations')
      .insert({
        name: `Audit Test Org ${Date.now()}`,
        legal_entity_name: `Audit Test Legal Entity ${Date.now()}`,
        is_active: true,
      })
      .select()
      .single();

    expect(orgErr).toBeNull();
    testOrgId = org.id;
  });

  it('1. Inserts Audit Event A and verifies deterministic genesis or previous hash', async () => {
    const { data: eventA, error: errA } = await adminClient
      .from('audit_logs')
      .insert({
        organisation_id: testOrgId,
        actor_role: 'SYSTEM',
        action: 'TEST_ACTION_A',
        entity_type: 'ORGANISATION',
        entity_id: testOrgId,
        details: { step: 'A', value: 100 },
      })
      .select()
      .single();

    expect(errA).toBeNull();
    expect(eventA).toBeDefined();
    expect(eventA.previous_hash).toBeDefined();
    expect(eventA.previous_hash.length).toBe(64);
    expect(eventA.current_hash).toBeDefined();
    expect(eventA.current_hash.length).toBe(64);

    // Recompute SHA-256 in Node crypto and assert exact equality
    const expectedPayload = `${eventA.previous_hash}|${eventA.actor_id || 'SYSTEM'}|${eventA.actor_role}|${eventA.organisation_id || ''}|${eventA.action}|${eventA.entity_type}|${eventA.entity_id || ''}|${formatPostgresJsonb(eventA.details)}|${formatPostgresTimestamp(eventA.created_at)}`;
    const recomputedHash = crypto.createHash('sha256').update(expectedPayload).digest('hex');
    expect(recomputedHash).toBe(eventA.current_hash);
  });

  it('2. Inserts Audit Event B and verifies cryptographic chaining and Node crypto SHA-256 match', async () => {
    // Get latest hash for this organisation
    const { data: latestLogs } = await adminClient
      .from('audit_logs')
      .select('id, current_hash')
      .eq('organisation_id', testOrgId)
      .order('id', { ascending: false })
      .limit(1);

    const prevHashExpected = latestLogs[0].current_hash;

    const { data: eventB, error: errB } = await adminClient
      .from('audit_logs')
      .insert({
        organisation_id: testOrgId,
        actor_role: 'SYSTEM',
        action: 'TEST_ACTION_B',
        entity_type: 'ORGANISATION',
        entity_id: testOrgId,
        details: { step: 'B', value: 200 },
      })
      .select()
      .single();

    expect(errB).toBeNull();
    expect(eventB).toBeDefined();
    expect(eventB.previous_hash).toBe(prevHashExpected);
    expect(eventB.current_hash).toBeDefined();
    expect(eventB.current_hash.length).toBe(64);
    expect(eventB.current_hash).not.toBe(eventB.previous_hash);

    // Cryptographic verification: Recompute SHA-256 independently and assert exact equality
    const expectedPayload = `${eventB.previous_hash}|${eventB.actor_id || 'SYSTEM'}|${eventB.actor_role}|${eventB.organisation_id || ''}|${eventB.action}|${eventB.entity_type}|${eventB.entity_id || ''}|${formatPostgresJsonb(eventB.details)}|${formatPostgresTimestamp(eventB.created_at)}`;
    const recomputedHash = crypto.createHash('sha256').update(expectedPayload).digest('hex');
    expect(recomputedHash).toBe(eventB.current_hash);
  });

  it('3. UPDATE on audit_logs must be strictly rejected by immutability trigger/policy', async () => {
    const { data: logs } = await adminClient
      .from('audit_logs')
      .select('id')
      .eq('organisation_id', testOrgId)
      .limit(1);

    const logId = logs[0].id;

    const { error: updateError } = await adminClient
      .from('audit_logs')
      .update({ action: 'TAMPERED_ACTION' })
      .eq('id', logId);

    // Database must reject updates to audit_logs
    expect(updateError).not.toBeNull();
  });

  it('4. DELETE on audit_logs must be strictly rejected by immutability trigger/policy', async () => {
    const { data: logs } = await adminClient
      .from('audit_logs')
      .select('id')
      .eq('organisation_id', testOrgId)
      .limit(1);

    const logId = logs[0].id;

    const { error: deleteError } = await adminClient
      .from('audit_logs')
      .delete()
      .eq('id', logId);

    // Database must reject deletions from audit_logs
    expect(deleteError).not.toBeNull();
  });

  it('5. Audit Concurrency Test: Proves pg_advisory_xact_lock prevents fork in linear chain', async () => {
    // Create dedicated org for concurrency verification
    const { data: concOrg } = await adminClient
      .from('organisations')
      .insert({
        name: `Concurrency Test Org ${Date.now()}`,
        legal_entity_name: `Concurrency Legal Entity ${Date.now()}`,
        is_active: true,
      })
      .select()
      .single();

    const concOrgId = concOrg.id;

    // Launch 5 concurrent inserts in parallel for the same organisation
    const insertPromises = Array.from({ length: 5 }, (_, i) =>
      adminClient
        .from('audit_logs')
        .insert({
          organisation_id: concOrgId,
          actor_role: 'SYSTEM',
          action: `CONCURRENT_EVENT_${i}`,
          entity_type: 'CONCURRENCY_TEST',
          entity_id: concOrgId,
          details: { seq: i, timestamp: Date.now() },
        })
        .select()
        .single()
    );

    const results = await Promise.all(insertPromises);

    for (const r of results) {
      expect(r.error).toBeNull();
      expect(r.data).toBeDefined();
    }

    // Retrieve all logs for this organisation ordered by id ascending
    const { data: allLogs, error: fetchErr } = await adminClient
      .from('audit_logs')
      .select('*')
      .eq('organisation_id', concOrgId)
      .order('id', { ascending: true });

    expect(fetchErr).toBeNull();
    expect(allLogs).toHaveLength(5);

    // 1. Assert exactly one linear chain: each event's previous_hash === preceding event's current_hash
    for (let i = 1; i < allLogs.length; i++) {
      const prevEvent = allLogs[i - 1];
      const currEvent = allLogs[i];
      expect(currEvent.previous_hash).toBe(prevEvent.current_hash);
    }

    // 2. Assert no duplicate previous_hash fork
    const previousHashes = allLogs.map((l: any) => l.previous_hash);
    const uniquePreviousHashes = new Set(previousHashes);
    expect(uniquePreviousHashes.size).toBe(5);

    // 3. Assert all hashes recompute correctly in Node crypto
    for (const event of allLogs) {
      const expectedPayload = `${event.previous_hash}|${event.actor_id || 'SYSTEM'}|${event.actor_role}|${event.organisation_id || ''}|${event.action}|${event.entity_type}|${event.entity_id || ''}|${formatPostgresJsonb(event.details)}|${formatPostgresTimestamp(event.created_at)}`;
      const recomputedHash = crypto.createHash('sha256').update(expectedPayload).digest('hex');
      expect(recomputedHash).toBe(event.current_hash);
    }
  });
});
