import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { GET as forecastGet } from '@/app/api/forecast/route';
import { GET as inputEvidenceGet } from '@/app/api/grid/input-evidence/route';
import { GET as readinessGet } from '@/app/api/sites/[id]/readiness/route';
import { GET as replayGet } from '@/app/api/grid/replay/route';
import { GET as visualGet } from '@/app/api/ingestion/load-visualization/route';
import { loadGridHistoricalInput, resolveGridInputEvidence } from '@/lib/analytics/grid-input-evidence';
import { checkServerEntitlement } from '@/lib/auth/entitlements';
import { resolveSiteForAuthorization } from '@/lib/auth/api-guard';
import { evaluateGridReadiness } from '@/features/onboarding/readiness';
import { POST as dsmPost } from '@/app/api/dsm/route';

vi.mock('server-only', () => ({}));

const analytics = vi.hoisted(() => ({
  dsm: vi.fn(async (_input: any) => ({})),
  grid: vi.fn(async (input: any) => ({
    site_id: input.siteId,
    operating_date: input.operatingDate,
    forecast_target_date: input.operatingDate,
    model_status: 'STALE_INPUT',
    validation_status: 'VALIDATED',
    forecast_available: false,
    forecast_status: 'SUPPRESSED',
    model_version: 'GRID_HISTORICAL_LOAD_V1.0',
    model_generation_time: '2026-09-15T00:00:00Z',
    training_start_date: input.historicalDays.at(0)?.operating_date ?? null,
    training_end_date: input.historicalDays.at(-1)?.operating_date ?? null,
    latest_input_date: input.historicalDays.at(-1)?.operating_date ?? null,
    freshness_days: 138,
    selected_model: 'PREVIOUS_WEEK_SAME_BLOCK',
    validation_metrics: { mae_kw: 10, rmse_kw: 12, smape_pct: 1, observations: 1344 },
    baseline_metrics: {},
    provenance: { input_source: 'COMMITTED_INTERVAL_DATA_96', model_family: 'DAY_AHEAD_DEMAND', validation_method: 'CHRONOLOGICAL_HOLDOUT', price_source: null },
    average_price_inr_per_mwh: null,
    peak_demand_kw: null,
    peak_demand_block: null,
    blocks: [],
    is_suppressed: true,
    suppression_reason: 'STALE_INPUT',
    confidence_status: 'UNAVAILABLE',
    data_quality: 'UNVERIFIED',
    freshness: 'STALE',
    price_status: 'AUTHORITATIVE_PRICE_FEED_REQUIRED',
  })),
}));
vi.mock('@/lib/analytics/client', () => ({
  fetchDSMCalculation: analytics.dsm,
  fetchGridForecast: analytics.grid,
}));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const stamp = crypto.randomUUID();
async function must(query: any): Promise<any> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

describe('Grid visibility of committed interval data', () => {
  let db: SupabaseClient;
  let userId: string;
  let token: string;
  let orgId: string;
  let foreignOrgId: string;
  let completeSiteId: string;
  let zeroSiteId: string;
  let incompleteSiteId: string;
  let unentitledSiteId: string;
  let foreignSiteId: string;
  let historySiteId: string;
  let historyLatestDate: string;

  beforeAll(async () => {
    if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Local Supabase only');
    db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    orgId = (await must(db.from('organisations').insert({ name: `Grid visibility ${stamp}`, legal_entity_name: 'Grid fixture' }).select('id').single())).id;
    foreignOrgId = (await must(db.from('organisations').insert({ name: `Grid foreign ${stamp}`, legal_entity_name: 'Foreign fixture' }).select('id').single())).id;
    const email = `grid-visibility-${stamp}@example.com`;
    const password = 'Strong-Test-Password!123';
    const created = await must(db.auth.admin.createUser({ email, password, email_confirm: true }));
    userId = created.user.id;
    await must(db.from('memberships').insert({ organisation_id: orgId, user_id: userId, role: 'ORGANISATION_ADMIN' }));

    const siteFields = { state: 'Maharashtra', discom: 'MSEDCL', voltage_category: '33kV', contract_demand_value: 1000,
      contract_demand_unit: 'kVA', metering_point: 'Main incomer', activation_status: 'ACTIVE', is_demo: false };
    const createSite = async (organisationId: string, name: string) =>
      (await must(db.from('sites').insert({ ...siteFields, organisation_id: organisationId, name }).select('id').single())).id;
    completeSiteId = await createSite(orgId, 'Complete history');
    zeroSiteId = await createSite(orgId, 'Zero history');
    incompleteSiteId = await createSite(orgId, 'Incomplete history');
    unentitledSiteId = await createSite(orgId, 'No Grid entitlement');
    foreignSiteId = await createSite(foreignOrgId, 'Foreign history');
    historySiteId = await createSite(orgId, '426-day history');

    await must(db.from('entitlements').insert([completeSiteId, zeroSiteId, incompleteSiteId, historySiteId].map((siteId) => ({
      organisation_id: orgId, site_id: siteId, product_id: 'GRID_INTELLIGENCE', is_active: true, granted_by: 'INTERNAL_TEST',
    }))));
    await must(db.from('entitlements').insert({
      organisation_id: orgId, site_id: completeSiteId, product_id: 'DSM_RISK', is_active: true, granted_by: 'INTERNAL_TEST',
    }));

    const rowsFor = (siteId: string, date: string, count: number) => Array.from({ length: count }, (_, index) => ({
      site_id: siteId,
      operating_date: date,
      block_index: index + 1,
      timestamp_utc: new Date(Date.parse(`${date}T00:00:00+05:30`) + index * 900000).toISOString(),
      load_kw: 900 + index,
      scheduled_drawal_kw: date === '2026-01-01' ? 1000 : 2000,
      actual_drawal_kw: date === '2026-01-01' ? 1100 : 2200,
      data_quality: 'PASSED',
    }));
    await must(db.from('interval_data_96').insert([
      ...rowsFor(completeSiteId, '2026-01-01', 96),
      ...rowsFor(completeSiteId, '2026-01-02', 96),
      ...rowsFor(completeSiteId, '2026-01-03', 91),
      ...rowsFor(incompleteSiteId, '2026-01-03', 91),
      ...rowsFor(foreignSiteId, '2026-01-01', 96),
    ]));

    const historyRows = Array.from({ length: 426 }, (_, dayIndex) => {
      const operatingDate = new Date(Date.UTC(2024, 0, dayIndex + 1)).toISOString().slice(0, 10);
      return rowsFor(historySiteId, operatingDate, 96);
    }).flat();
    historyLatestDate = historyRows.at(-1)!.operating_date;
    for (let offset = 0; offset < historyRows.length; offset += 2000) {
      await must(db.from('interval_data_96').insert(historyRows.slice(offset, offset + 2000)));
    }
    await must(db.from('data_quality_evaluations').insert(historyRows.filter((_, index) => index % 96 === 0)
      .map((row) => ({ site_id: historySiteId, evaluation_date: row.operating_date,
        completeness_pct: 100, missing_blocks_count: 0, freshness_status: 'STALE',
        validation_status: 'PASSED', publication_gate_status: 'BLOCKED_STALE_DATA' }))));
    await must(db.from('data_quality_evaluations').insert({ site_id: foreignSiteId,
      evaluation_date: '2026-01-01', completeness_pct: 100, missing_blocks_count: 0,
      freshness_status: 'STALE', validation_status: 'PASSED', publication_gate_status: 'BLOCKED_STALE_DATA' }));
    await must(db.from('renewable_assets').insert([
      { site_id: unentitledSiteId, name: 'Own solar', installed_capacity_kw: 100 },
      { site_id: foreignSiteId, name: 'Foreign solar', installed_capacity_kw: 100 },
    ]));
    await must(db.from('bess_assets').insert([
      { site_id: unentitledSiteId, name: 'Own battery', usable_capacity_kwh: 500, power_rating_kw: 250 },
      { site_id: foreignSiteId, name: 'Foreign battery', usable_capacity_kwh: 500, power_rating_kw: 250 },
    ]));

    const userClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    token = (await must(userClient.auth.signInWithPassword({ email, password }))).session.access_token;
  }, 120000);

  afterAll(async () => {
    if (db && orgId) await db.from('organisations').delete().eq('id', orgId);
    if (db && foreignOrgId) await db.from('organisations').delete().eq('id', foreignOrgId);
    if (db && userId) await db.auth.admin.deleteUser(userId);
  });

  const forecastRequest = (siteId: string, operatingDate?: string) => new NextRequest(
    `http://localhost:3000/api/forecast?siteId=${siteId}${operatingDate ? `&operatingDate=${operatingDate}` : ''}`,
    { method: 'GET', headers: { Authorization: `Bearer ${token}` } }
  );
  const evidenceRequest = (siteId: string, operatingDate?: string) => new NextRequest(
    `http://localhost:3000/api/grid/input-evidence?site_id=${siteId}${operatingDate ? `&operating_date=${operatingDate}` : ''}`,
    { method: 'GET', headers: { Authorization: `Bearer ${token}` } }
  );
  const visualRequest = (siteId: string, operatingDate?: string, bearer = token) => new NextRequest(
    `http://localhost:3000/api/ingestion/load-visualization?site_id=${siteId}&window_days=30${operatingDate ? `&operating_date=${operatingDate}` : ''}`,
    { headers: { Authorization: `Bearer ${bearer}` } }
  );

  const readinessRequest = (siteId: string, bearer = token) => new NextRequest(
    `http://localhost:3000/api/sites/${siteId}/readiness`,
    { headers: { Authorization: `Bearer ${bearer}` } }
  );

  it('reads 426 complete committed days through the bearer, keeps old input stale and optional evidence missing', async () => {
    const response = await readinessGet(readinessRequest(historySiteId), { params: { id: historySiteId } });
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      site_id: historySiteId,
      interval_evidence: { has_validated_history: true, validated_complete_days: 426,
        latest_operating_date: historyLatestDate, latest_evidence_valid: true,
        quality_status: 'PASSED', freshness_status: 'STALE', source: 'interval_data_96' },
      alert_recipient: { configured: false, source: 'NOT_CONFIGURED' },
      renewable_asset: { configured: false }, bess_asset: { configured: false },
    });
    expect(evaluateGridReadiness({ state: 'Maharashtra', discom: 'MSEDCL', contractDemandValue: 1000,
      voltageCategory: '33kV', hasHistoricalIntervals: body.interval_evidence.has_validated_history,
      intervalDaysCount: body.interval_evidence.validated_complete_days,
      latestIntervalValid: body.interval_evidence.latest_evidence_valid,
      intervalQualityStatus: body.interval_evidence.quality_status,
      intervalFreshnessStatus: body.interval_evidence.freshness_status,
      hasAlertRecipient: body.alert_recipient.configured,
      hasSolarAsset: body.renewable_asset.configured, hasBessAsset: body.bess_asset.configured,
    }).readinessPct).toBe(60);
  }, 120000);

  it('keeps zero and incomplete interval evidence distinct from an API error', async () => {
    const zero = await readinessGet(readinessRequest(zeroSiteId), { params: { id: zeroSiteId } });
    expect(zero.status).toBe(200);
    expect(await zero.json()).toMatchObject({ interval_evidence: {
      has_validated_history: false, validated_complete_days: 0, latest_operating_date: null,
      quality_status: 'NO_DATA', freshness_status: 'UNKNOWN',
    } });
    const incomplete = await readinessGet(readinessRequest(incompleteSiteId), { params: { id: incompleteSiteId } });
    expect(incomplete.status).toBe(200);
    expect(await incomplete.json()).toMatchObject({ interval_evidence: {
      has_validated_history: false, validated_complete_days: 0, latest_operating_date: '2026-01-03',
      latest_evidence_valid: false, quality_status: 'FAILED', freshness_status: 'STALE',
    } });
    const partialHistory = await readinessGet(readinessRequest(completeSiteId), { params: { id: completeSiteId } });
    expect(partialHistory.status).toBe(200);
    expect(await partialHistory.json()).toMatchObject({ interval_evidence: {
      has_validated_history: true, validated_complete_days: 2, latest_operating_date: '2026-01-03',
      latest_evidence_valid: false, quality_status: 'FAILED', freshness_status: 'STALE',
    } });
  }, 30000);

  it('denies invalid bearer and foreign-site readiness before reading evidence', async () => {
    const invalid = await readinessGet(readinessRequest(completeSiteId, 'invalid-token'), { params: { id: completeSiteId } });
    expect(invalid.status).toBe(401);
    const foreign = await readinessGet(readinessRequest(foreignSiteId), { params: { id: foreignSiteId } });
    expect(foreign.status).toBe(403);
  });

  it('reads own readiness tables under bearer RLS and hides foreign rows', async () => {
    const bearerClient = createClient(url, anonKey, { accessToken: async () => token });
    for (const [table, ownSiteId] of [
      ['data_quality_evaluations', historySiteId],
      ['renewable_assets', unentitledSiteId],
      ['bess_assets', unentitledSiteId],
    ] as const) {
      const own = await bearerClient.from(table).select('id').eq('site_id', ownSiteId).limit(1);
      expect(own.error, `${table}: ${own.error?.message}`).toBeNull();
      expect(own.data).toHaveLength(1);
      const foreign = await bearerClient.from(table).select('id').eq('site_id', foreignSiteId);
      expect(foreign.error, `${table}: ${foreign.error?.message}`).toBeNull();
      expect(foreign.data).toEqual([]);
    }
    const anonymousClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    for (const table of ['data_quality_evaluations', 'renewable_assets', 'bess_assets'] as const) {
      const anonymous = await anonymousClient.from(table).select('id').eq('site_id', unentitledSiteId);
      expect(anonymous.data || []).toEqual([]);
    }
  });

  it('serves ordered committed load visualization through the bearer site context without analytics', async () => {
    analytics.grid.mockClear();
    const response = await visualGet(visualRequest(completeSiteId, '2026-01-01'));
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ site_id: completeSiteId, source: 'COMMITTED_INTERVAL_DATA_96', selected_date: '2026-01-01',
      summary: { valid_days: 2, valid_blocks: 192 } });
    expect(body.selected_profile).toHaveLength(96);
    expect(body.selected_profile[0]).toMatchObject({ block_index: 1, load_kw: 900 });
    expect(body.selected_profile[95]).toMatchObject({ block_index: 96, load_kw: 995 });
    expect(analytics.grid).not.toHaveBeenCalled();
  });

  it('returns only a recent bounded slice of 426 committed days, anchored at latest complete day', async () => {
    const response = await visualGet(visualRequest(historySiteId));
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    const body = await response.json();
    expect(body.selected_date).toBe(historyLatestDate);
    expect(body.selected_profile).toHaveLength(96);
    expect(body.summary.valid_days).toBe(30);
    expect(body.summary.valid_blocks).toBe(2880);
    expect(body.heatmap).toHaveLength(30);
    expect(body.daily_trend).toHaveLength(30);
  });

  it('keeps zero input empty and incomplete day out of PASSED aggregates', async () => {
    const zero = await (await visualGet(visualRequest(zeroSiteId))).json();
    expect(zero.summary).toMatchObject({ valid_days: 0, valid_blocks: 0, completeness_pct: 0 });
    expect(zero.selected_profile).toEqual([]);
    const incomplete = await (await visualGet(visualRequest(incompleteSiteId, '2026-01-03'))).json();
    expect(incomplete.selected_profile).toHaveLength(91);
    expect(incomplete.summary.valid_blocks).toBe(0);
  });

  it('denies missing/invalid bearer and foreign site while keeping ingestion visualization independent of Grid billing', async () => {
    const noBearer = await visualGet(new NextRequest(`http://localhost:3000/api/ingestion/load-visualization?site_id=${completeSiteId}`));
    expect(noBearer.status).toBe(401);
    expect((await visualGet(visualRequest(completeSiteId, undefined, 'invalid'))).status).toBe(401);
    const foreign = await visualGet(visualRequest(foreignSiteId));
    expect(foreign.status).toBe(403);
    expect((await foreign.json()).error).toBe('FORBIDDEN_ORGANISATION');
    expect((await visualGet(visualRequest(unentitledSiteId))).status).toBe(200);
  });

  it('reads a committed own-site day as 96/96 independently from forecast output', async () => {
    const response = await inputEvidenceGet(evidenceRequest(completeSiteId, '2026-01-01'));
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      site_id: completeSiteId,
      operating_date: '2026-01-01',
      expected_blocks: 96,
      received_blocks: 96,
      completeness_pct: 100,
      duplicate_blocks: [],
      missing_blocks: [],
      quality_status: 'PASSED',
      data_available: true,
    });
    const forecast = await forecastGet(forecastRequest(completeSiteId, '2026-01-01'));
    expect(forecast.status).toBe(200);
    const forecastBody = await forecast.json();
    expect(forecastBody).toMatchObject({ is_suppressed: true, forecast_available: false, blocks: [] });
    expect(forecastBody).not.toHaveProperty('input_evidence');
    expect(body).toMatchObject({ received_blocks: 96, completeness_pct: 100 });
    expect(await checkServerEntitlement(orgId, completeSiteId, 'GRID_INTELLIGENCE')).toMatchObject({ entitled: true });
  });

  it('keeps previously retrieved evidence independent from a forecast HTTP failure', async () => {
    const evidence = await (await inputEvidenceGet(evidenceRequest(completeSiteId, '2026-01-01'))).json();
    const failedForecast = await forecastGet(forecastRequest(completeSiteId, 'not-a-date'));
    expect(failedForecast.status).toBe(400);
    expect(evidence).toMatchObject({ operating_date: '2026-01-01', received_blocks: 96, completeness_pct: 100 });
  });

  it('rejects a malformed analytics response as INVALID_ANALYTICS_CONTRACT', async () => {
    analytics.grid.mockResolvedValueOnce({ site_id: completeSiteId, forecast_available: false } as any);
    const response = await forecastGet(forecastRequest(completeSiteId, '2026-01-01'));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: 'INVALID_ANALYTICS_CONTRACT' });
  });

  it('requires an explicit bearer token for input evidence', async () => {
    const response = await inputEvidenceGet(new NextRequest(
      `http://localhost:3000/api/grid/input-evidence?site_id=${completeSiteId}`
    ));
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe('AUTHENTICATED_BEARER_REQUIRED');
  });

  it('uses the bearer JWT as authenticated and applies site RLS', async () => {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    expect(claims.role).toBe('authenticated');
    const bearerClient = createClient(url, anonKey, { accessToken: async () => token });
    expect(await must(bearerClient.from('sites').select('id,organisation_id').eq('id', completeSiteId).single()))
      .toEqual({ id: completeSiteId, organisation_id: orgId });
    expect(await must(bearerClient.from('sites').select('id').eq('id', foreignSiteId))).toEqual([]);
    expect((await must(bearerClient.from('interval_data_96').select('block_index').eq('site_id', completeSiteId).eq('operating_date', '2026-01-01')))).toHaveLength(96);
    expect(await must(bearerClient.from('interval_data_96').select('block_index').eq('site_id', foreignSiteId))).toEqual([]);
  });

  it('keeps anonymous and authenticated direct writes blocked', async () => {
    const anonymousClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    expect(await must(anonymousClient.from('interval_data_96').select('block_index').eq('site_id', completeSiteId))).toEqual([]);

    const bearerClient = createClient(url, anonKey, { accessToken: async () => token });
    const unauthorizedRow = {
      site_id: completeSiteId,
      operating_date: '2030-01-01',
      block_index: 1,
      timestamp_utc: '2029-12-31T18:30:00.000Z',
      load_kw: 1,
      data_quality: 'PASSED',
    };
    expect((await bearerClient.from('interval_data_96').insert(unauthorizedRow)).error).toBeTruthy();
    const update = await bearerClient.from('interval_data_96').update({ load_kw: 1 }).eq('site_id', completeSiteId).select('id');
    const deletion = await bearerClient.from('interval_data_96').delete().eq('site_id', completeSiteId).select('id');
    expect(update.error || (update.data || []).length === 0).toBeTruthy();
    expect(deletion.error || (deletion.data || []).length === 0).toBeTruthy();
    const unchanged = await db.from('interval_data_96').select('id', { count: 'exact', head: true })
      .eq('site_id', completeSiteId).eq('operating_date', '2026-01-01');
    expect(unchanged.error).toBeNull();
    expect(unchanged.count).toBe(96);
  });

  it('classifies a PostgreSQL privilege error as lookup failure rather than not-found or RLS denial', async () => {
    const deniedClient = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'permission denied for table sites' } }) }) }) }),
    } as unknown as SupabaseClient;
    expect(await resolveSiteForAuthorization(deniedClient, db, completeSiteId)).toEqual({
      status: 'LOOKUP_FAILED', source: 'authenticated', message: 'permission denied for table sites',
    });
  });

  it('resolves the latest committed day and honors an explicitly requested complete day', async () => {
    expect(await resolveGridInputEvidence(db, completeSiteId)).toMatchObject({ operating_date: '2026-01-02', total_blocks_received: 96, is_complete: true });
    expect(await resolveGridInputEvidence(db, completeSiteId, '2026-01-01')).toMatchObject({ operating_date: '2026-01-01', total_blocks_received: 96, is_complete: true });
    const body = await (await inputEvidenceGet(evidenceRequest(completeSiteId))).json();
    expect(body).toMatchObject({ operating_date: '2026-01-02', received_blocks: 96, completeness_pct: 100 });
  });

  it('selects the latest complete day from a 426-day committed dataset without invoking analytics', async () => {
    analytics.grid.mockClear();
    const response = await inputEvidenceGet(evidenceRequest(historySiteId));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      site_id: historySiteId,
      operating_date: historyLatestDate,
      received_blocks: 96,
      completeness_pct: 100,
      data_available: true,
    });
    expect(analytics.grid).not.toHaveBeenCalled();
  });

  it('passes all 426 complete days to forecasting and targets the next operating day', async () => {
    analytics.grid.mockClear();
    const response = await forecastGet(forecastRequest(historySiteId));
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    expect(await response.json()).toMatchObject({
      site_id: historySiteId,
      model_status: 'STALE_INPUT',
      forecast_status: 'SUPPRESSED',
      forecast_available: false,
      blocks: [],
      price_status: 'AUTHORITATIVE_PRICE_FEED_REQUIRED',
    });
    expect(analytics.grid).toHaveBeenCalledOnce();
    const input = analytics.grid.mock.calls[0][0];
    expect(input.historicalDays).toHaveLength(426);
    expect(input.historicalDays.at(-1).operating_date).toBe(historyLatestDate);
    const expectedTarget = new Date(`${historyLatestDate}T00:00:00Z`);
    expectedTarget.setUTCDate(expectedTarget.getUTCDate() + 1);
    expect(input.operatingDate).toBe(expectedTarget.toISOString().slice(0, 10));
    expect(input.latestInputComplete).toBe(true);
    expect(input.historicalDays.every((day: any) => day.load_kw.length === 96)).toBe(true);
  });

  it('loads completed replay history with the same bearer client and excludes later days', async () => {
    const bearerClient = createClient(url, anonKey, { accessToken: async () => token });
    const history = await loadGridHistoricalInput(bearerClient, completeSiteId, 426, '2026-01-02');
    expect(history.complete_days.map((day) => day.operating_date)).toEqual(['2026-01-01', '2026-01-02']);
    expect(history.complete_days.every((day) => day.load_kw.length === 96)).toBe(true);
  });

  it('replay route reads its own 96-block selected day and passes bearer-visible history to analytics', async () => {
    analytics.grid.mockClear();
    const request = new NextRequest(`http://localhost:3000/api/grid/replay?site_id=${historySiteId}&operating_date=${historyLatestDate}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const response = await replayGet(request);
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ site_id: historySiteId, mode: 'HISTORICAL_REPLAY',
      replay_input_date: historyLatestDate, load_status: 'PASSED', replay_ready: false,
      input_evidence: { total_blocks_received: 96, quality_status: 'PASSED' } });
    expect(analytics.grid).toHaveBeenCalledWith(expect.objectContaining({ historicalReplay: true, siteId: historySiteId,
      historicalDays: expect.arrayContaining([expect.objectContaining({ operating_date: historyLatestDate, load_kw: expect.any(Array) })]) }));
  }, 60000);

  it('replay denies an invalid bearer, a foreign site and an own site without Grid entitlement', async () => {
    const replayRequest = (id: string, bearer: string) => new NextRequest(
      `http://localhost:3000/api/grid/replay?site_id=${id}&operating_date=2026-01-01`,
      { headers: { Authorization: `Bearer ${bearer}` } }
    );
    const invalid = await replayGet(replayRequest(completeSiteId, 'invalid-token'));
    expect(invalid.status).toBe(401);
    expect((await invalid.json()).error).toBe('INVALID_BEARER_TOKEN');
    const foreign = await replayGet(replayRequest(foreignSiteId, token));
    expect(foreign.status).toBe(403);
    expect((await foreign.json()).error).toBe('FORBIDDEN_ORGANISATION');
    const unsubscribed = await replayGet(replayRequest(unentitledSiteId, token));
    expect(unsubscribed.status).toBe(403);
    expect((await unsubscribed.json()).error).toBe('UNSUBSCRIBED');
  });

  it('gives DSM only the explicitly requested day from multi-day site history', async () => {
    analytics.dsm.mockClear();
    const response = await dsmPost(new NextRequest('http://localhost:3000/api/dsm', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: completeSiteId, operatingDate: '2026-01-01' }),
    }));
    expect(response.status).toBe(200);
    expect(analytics.dsm).toHaveBeenCalledOnce();
    expect(analytics.dsm.mock.calls[0][0]).toMatchObject({
      siteId: completeSiteId,
      operatingDate: '2026-01-01',
      scheduledDrawalKw: Array(96).fill(1000),
      actualDrawalKw: Array(96).fill(1100),
    });
  });

  it('denies a foreign organisation site', async () => {
    const response = await inputEvidenceGet(evidenceRequest(foreignSiteId));
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe('FORBIDDEN_ORGANISATION');
  });

  it('keeps a zero-data site hard-suppressed at 0/96', async () => {
    const response = await inputEvidenceGet(evidenceRequest(zeroSiteId));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ operating_date: null, expected_blocks: 96, received_blocks: 0, completeness_pct: 0, data_available: false });
    expect(body.missing_blocks).toHaveLength(96);
  });

  it('keeps an incomplete operating day hard-suppressed', async () => {
    const response = await inputEvidenceGet(evidenceRequest(incompleteSiteId, '2026-01-03'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ expected_blocks: 96, received_blocks: 91, quality_status: 'FAILED', data_available: true });
    expect(body.completeness_pct).toBeLessThan(95);
    expect(body.missing_blocks).toHaveLength(5);
  });
});
