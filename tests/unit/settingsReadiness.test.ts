import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateGridReadiness } from '@/features/onboarding/readiness';
import { GET as readinessGet } from '@/app/api/sites/[id]/readiness/route';

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), admin: vi.fn() }));
vi.mock('@/lib/auth/api-guard', () => ({ authorizeApiRequest: mocks.authorize }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }));

const baseConfig = {
  state: 'Maharashtra', discom: 'MSEDCL', contractDemandValue: 1500, voltageCategory: '33kV',
  hasHistoricalIntervals: true, intervalDaysCount: 7, intervalQualityStatus: 'PASSED' as const,
  intervalFreshnessStatus: 'RECENT' as const, latestIntervalDate: '2026-09-17', isDemo: false,
  latestIntervalValid: true,
  hasAlertRecipient: true, hasSolarAsset: false, hasBessAsset: false,
};

function item(result: ReturnType<typeof evaluateGridReadiness>, key: string) {
  return result.items.find((entry) => entry.key === key)!;
}

function database(overrides: Record<string, { data: any; error: any }> = {}) {
  const results: Record<string, { data: any; error: any }> = {
    sites: { data: { id: 'site-1', is_demo: false, activation_status: 'CALIBRATING' }, error: null },
    data_quality_evaluations: { data: [
      { evaluation_date: '2026-09-17', completeness_pct: 100, missing_blocks_count: 0,
        freshness_status: 'RECENT', validation_status: 'PASSED', publication_gate_status: 'PUBLISHABLE' },
      { evaluation_date: '2026-09-16', completeness_pct: 100, missing_blocks_count: 0,
        freshness_status: 'DELAYED', validation_status: 'PASSED', publication_gate_status: 'PUBLISHABLE' },
    ], error: null },
    renewable_assets: { data: [{ id: 'solar-1' }], error: null },
    bess_assets: { data: [{ id: 'bess-1' }], error: null },
    ...overrides,
  };
  return { from: vi.fn((table: string) => {
    const builder: any = {};
    builder.select = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.order = vi.fn(() => builder);
    builder.limit = vi.fn(async () => results[table]);
    builder.single = vi.fn(async () => results[table]);
    return builder;
  }) };
}

describe('Settings authoritative readiness contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({ authorized: true, organisationId: 'org-1' });
    mocks.admin.mockReturnValue(database());
  });

  it('does not report missing historical interval evidence as ready', () => {
    const result = evaluateGridReadiness({ ...baseConfig, hasHistoricalIntervals: false, intervalDaysCount: 0,
      intervalQualityStatus: 'NO_DATA', intervalFreshnessStatus: 'UNKNOWN' });
    expect(item(result, 'historical_load')).toMatchObject({ category: 'RECOMMENDED', isSatisfied: false, status: 'MISSING' });
    expect(item(result, 'interval_freshness')).toMatchObject({ isSatisfied: false, status: 'MISSING' });
    expect(result.isReadyForMonitoring).toBe(false);
  });

  it('uses recommended validated history and required current freshness as separate evidence', () => {
    const ready = evaluateGridReadiness(baseConfig);
    expect(item(ready, 'historical_load')).toMatchObject({ category: 'RECOMMENDED', isSatisfied: true, status: 'READY' });
    expect(item(ready, 'interval_freshness')).toMatchObject({ isSatisfied: true, status: 'READY' });
    expect(ready.readinessPct).toBe(100);
    const stale = evaluateGridReadiness({ ...baseConfig, intervalFreshnessStatus: 'STALE' });
    expect(item(stale, 'historical_load').isSatisfied).toBe(true);
    expect(item(stale, 'interval_freshness')).toMatchObject({ isSatisfied: false, status: 'STALE' });
    expect(stale.readinessPct).toBe(80);
  });

  it('requires a persisted alert recipient in the required-readiness percentage', () => {
    const missing = evaluateGridReadiness({ ...baseConfig, hasAlertRecipient: false });
    const configured = evaluateGridReadiness(baseConfig);
    expect(item(missing, 'alert_recipient')).toMatchObject({ category: 'REQUIRED', isSatisfied: false, status: 'MISSING' });
    expect(item(configured, 'alert_recipient')).toMatchObject({ category: 'REQUIRED', isSatisfied: true, status: 'READY' });
    expect(missing.readinessPct).toBe(80);
    expect(missing.isReadyForMonitoring).toBe(false);
    expect(configured.readinessPct).toBe(100);
    expect(configured.isReadyForMonitoring).toBe(true);
  });

  it('derives optional Solar and BESS configuration only from actual asset flags', () => {
    const absent = evaluateGridReadiness(baseConfig);
    const configured = evaluateGridReadiness({ ...baseConfig, hasSolarAsset: true, hasBessAsset: true });
    expect(item(absent, 'solar_config').isSatisfied).toBe(false);
    expect(item(absent, 'bess_config').isSatisfied).toBe(false);
    expect(item(configured, 'solar_config').isSatisfied).toBe(true);
    expect(item(configured, 'bess_config').isSatisfied).toBe(true);
    expect(absent.readinessPct).toBe(configured.readinessPct);
  });

  it('never treats demo evidence as authoritative live readiness', () => {
    const result = evaluateGridReadiness({ ...baseConfig, isDemo: true, hasAlertRecipient: true, hasSolarAsset: true, hasBessAsset: true });
    for (const key of ['historical_load', 'interval_freshness', 'alert_recipient', 'solar_config', 'bess_config']) {
      expect(item(result, key)).toMatchObject({ isSatisfied: false, status: 'DEMO_UNVERIFIED' });
    }
  });

  it('loads tenant-scoped persisted quality and asset evidence without entitlement inference', async () => {
    const response = await readinessGet(new NextRequest('http://localhost/api/sites/site-1/readiness', {
      headers: { Authorization: 'Bearer token' },
    }), { params: { id: 'site-1' } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      site_id: 'site-1',
      interval_evidence: { has_validated_history: true, validated_complete_days: 2, latest_operating_date: '2026-09-17' },
      alert_recipient: { configured: false, source: 'NOT_CONFIGURED' },
      renewable_asset: { configured: true },
      bess_asset: { configured: true },
    });
    expect(mocks.authorize).toHaveBeenCalledWith(expect.anything(), { siteId: 'site-1', requireBearer: true });
    expect(mocks.admin.mock.results[0].value.from).not.toHaveBeenCalledWith('entitlements');
  });

  it('denies a foreign site before any readiness evidence query', async () => {
    mocks.authorize.mockResolvedValueOnce({ authorized: false, response: NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 }) });
    const response = await readinessGet(new NextRequest('http://localhost/api/sites/foreign/readiness'), { params: { id: 'foreign' } });
    expect(response.status).toBe(403);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it('fails closed when persisted readiness evidence cannot be read', async () => {
    mocks.admin.mockReturnValueOnce(database({ data_quality_evaluations: { data: null, error: { message: 'permission denied' } } }));
    const response = await readinessGet(new NextRequest('http://localhost/api/sites/site-1/readiness'), { params: { id: 'site-1' } });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'SITE_READINESS_LOOKUP_FAILED' });
  });

  it('contains no hard-coded satisfied readiness evidence in Settings', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/settings/page.tsx'), 'utf8');
    const shell = readFileSync(resolve(process.cwd(), 'src/components/layout/AppShell.tsx'), 'utf8');
    expect(source).not.toContain('hasAlertRecipient: true');
    expect(source).not.toContain('hasHistoricalIntervals: true');
    expect(source).not.toContain('intervalDaysCount: 30');
    expect(source).not.toContain('hasSolarAsset: true');
    expect(source).not.toContain('hasBessAsset: true');
    expect(source).toContain('/readiness');
    expect(shell).toContain('currentSite?.is_demo ?');
    expect(shell).toContain('LIVE SITE · EVIDENCE PER MODULE');
  });
});
