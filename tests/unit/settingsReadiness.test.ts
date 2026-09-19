import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateGridReadiness } from '@/features/onboarding/readiness';
import { GET as readinessGet } from '@/app/api/sites/[id]/readiness/route';

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), history: vi.fn(), evidence: vi.fn() }));
vi.mock('@/lib/auth/api-guard', () => ({ authorizeApiRequest: mocks.authorize }));
vi.mock('@/lib/analytics/grid-input-evidence', () => ({
  loadGridHistoricalInput: mocks.history,
  resolveGridInputEvidence: mocks.evidence,
}));

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
    data_quality_evaluations: { data: [], error: null },
    interval_data_96: { data: { operating_date: '2026-04-30' }, error: null },
    renewable_assets: { data: [{ id: 'solar-1' }], error: null },
    bess_assets: { data: [{ id: 'bess-1' }], error: null },
    ...overrides,
  };
  return { from: vi.fn((table: string) => {
    const builder: any = {};
    builder.select = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.limit = vi.fn(() => builder);
    builder.single = vi.fn(async () => results[table]);
    builder.maybeSingle = vi.fn(async () => results[table]);
    builder.order = vi.fn(() => builder);
    builder.then = (resolve: (value: any) => void, reject: (error: unknown) => void) =>
      Promise.resolve(results[table]).then(resolve, reject);
    return builder;
  }) };
}

describe('Settings authoritative readiness contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({ authorized: true, organisationId: 'org-1', authenticatedClient: database() });
    mocks.history.mockResolvedValue({ complete_days: [{ operating_date: '2026-04-29' }, { operating_date: '2026-04-30' }],
      latest_observed_date: '2026-04-30', latest_observed_complete: true });
    mocks.evidence.mockResolvedValue({ is_complete: true, quality_status: 'PASSED', freshness: 'STALE' });
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

  it('loads bearer-scoped committed history and asset evidence without entitlement inference', async () => {
    const response = await readinessGet(new NextRequest('http://localhost/api/sites/site-1/readiness', {
      headers: { Authorization: 'Bearer token' },
    }), { params: { id: 'site-1' } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      site_id: 'site-1',
      interval_evidence: { has_validated_history: true, validated_complete_days: 2,
        latest_operating_date: '2026-04-30', latest_evidence_valid: true, quality_status: 'PASSED', freshness_status: 'STALE',
        source: 'interval_data_96' },
      alert_recipient: { configured: false, source: 'NOT_CONFIGURED' },
      renewable_asset: { configured: true },
      bess_asset: { configured: true },
    });
    expect(mocks.authorize).toHaveBeenCalledWith(expect.anything(), { siteId: 'site-1', requireBearer: true });
    const bearerClient = (await mocks.authorize.mock.results[0].value).authenticatedClient;
    expect(mocks.history).toHaveBeenCalledWith(bearerClient, 'site-1', 426, '2026-04-30');
    expect(mocks.evidence).toHaveBeenCalledWith(bearerClient, 'site-1', '2026-04-30');
    expect(bearerClient.from).not.toHaveBeenCalledWith('entitlements');
  });

  it('returns missing optional assets and recipient without failing the route', async () => {
    mocks.authorize.mockResolvedValueOnce({ authorized: true, organisationId: 'org-1', authenticatedClient: database({
      renewable_assets: { data: [], error: null }, bess_assets: { data: [], error: null },
    }) });
    const response = await readinessGet(new NextRequest('http://localhost/api/sites/site-1/readiness'), { params: { id: 'site-1' } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      alert_recipient: { configured: false, source: 'NOT_CONFIGURED' },
      renewable_asset: { configured: false }, bess_asset: { configured: false },
    });
  });

  it('counts canonical persisted quality days without scanning the entire load history', async () => {
    mocks.authorize.mockResolvedValueOnce({ authorized: true, organisationId: 'org-1', authenticatedClient: database({
      data_quality_evaluations: { data: [
        { evaluation_date: '2026-04-29', completeness_pct: 100, missing_blocks_count: 0, validation_status: 'PASSED' },
        { evaluation_date: '2026-04-30', completeness_pct: 100, missing_blocks_count: 0, validation_status: 'PASSED' },
      ], error: null },
    }) });
    const response = await readinessGet(new NextRequest('http://localhost/api/sites/site-1/readiness'), { params: { id: 'site-1' } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ interval_evidence: { validated_complete_days: 2, freshness_status: 'STALE' } });
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it('denies a foreign site before any readiness evidence query', async () => {
    mocks.authorize.mockResolvedValueOnce({ authorized: false, response: NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 }) });
    const response = await readinessGet(new NextRequest('http://localhost/api/sites/foreign/readiness'), { params: { id: 'foreign' } });
    expect(response.status).toBe(403);
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it('fails closed when persisted readiness evidence cannot be read', async () => {
    mocks.history.mockRejectedValueOnce(new Error('permission denied for table interval_data_96'));
    const response = await readinessGet(new NextRequest('http://localhost/api/sites/site-1/readiness'), { params: { id: 'site-1' } });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'SITE_READINESS_LOOKUP_FAILED' });
  });

  it('does not treat an optional asset query error as an absent asset', async () => {
    mocks.authorize.mockResolvedValueOnce({ authorized: true, organisationId: 'org-1', authenticatedClient: database({
      renewable_assets: { data: null, error: { message: 'permission denied for table renewable_assets' } },
    }) });
    const response = await readinessGet(new NextRequest('http://localhost/api/sites/site-1/readiness'), { params: { id: 'site-1' } });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'SITE_READINESS_LOOKUP_FAILED' });
    expect(mocks.history).not.toHaveBeenCalled();
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
