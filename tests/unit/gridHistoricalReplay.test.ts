import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { GET as replayGet } from '@/app/api/grid/replay/route';
import { HistoricalReplayPanel } from '@/app/grid-intelligence/HistoricalReplayPanel';
import { assessReplayPrices, calculateReplayOutputs, REPLAY_LABEL, type ReplayPriceRow } from '@/lib/analytics/grid-replay';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(), input: vi.fn(), history: vi.fn(), analytics: vi.fn(), admin: vi.fn(),
}));
vi.mock('@/lib/auth/api-guard', () => ({ authorizeApiRequest: mocks.authorize }));
vi.mock('@/lib/analytics/grid-input-evidence', () => ({ resolveGridInputEvidence: mocks.input, loadGridHistoricalInput: mocks.history }));
vi.mock('@/lib/analytics/client', () => ({ fetchGridForecast: mocks.analytics }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { getSession: async () => ({
  data: { session: { access_token: 'fixture-access-token' } }, error: null,
}) } }) }));

const liveFixture = JSON.parse(readFileSync(resolve(process.cwd(), 'tests/fixtures/grid_forecast_contract_responses.json'), 'utf8')).validated;
const siteId = 'b4233eac-4f81-4bd2-bab7-8f4e1b1314ab';
const orgId = '129cfc77-f611-4191-9b9c-b248452e5641';
const inputDate = '2026-04-30';
const targetDate = '2026-05-01';
const prices = (): ReplayPriceRow[] => Array.from({ length: 96 }, (_, index) => {
  const minutes = index * 15;
  const end = (index + 1) * 15;
  const hhmm = (value: number) => value === 1440 ? '24:00' : `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  return { delivery_date: targetDate, block_index: index + 1, time_start: hhmm(minutes), time_end: hhmm(end),
    mcp_rs_per_mwh: 2660.48 + index, source_type: 'OFFICIAL_IEX_EXPORT', source_reference: 'IEX DAM publication',
    source_file_hash: 'fixture-hash', provenance_status: 'OFFICIAL_SOURCE_CONFIRMED', verification_status: 'VERIFIED' };
});
const request = (date = inputDate, id = siteId, bearer = true) => new NextRequest(
  `http://localhost:3000/api/grid/replay?site_id=${id}&operating_date=${date}`,
  { headers: bearer ? { Authorization: 'Bearer fixture-access-token' } : {} }
);

describe('historical Grid replay safety', () => {
  let priceRows: ReplayPriceRow[];
  let actualRows: Array<{ block_index: number; load_kw: number; data_quality: string }>;
  let bearerClient: unknown;
  beforeEach(() => {
    vi.clearAllMocks();
    priceRows = prices();
    actualRows = [];
    const client = { from: (table: string) => ({
      select: () => ({ eq: () => ({ eq: () => ({ order: async () => ({ data: table === 'interval_data_96' ? actualRows : null, error: null }) }),
        maybeSingle: async () => ({ data: { id: siteId, organisation_id: orgId, is_demo: false, contract_demand_value: 1000 }, error: null }) }) }),
    }) };
    bearerClient = client;
    mocks.authorize.mockResolvedValue({ authorized: true, organisationId: orgId, isDemo: false, authenticatedClient: client });
    mocks.input.mockResolvedValue({ operating_date: inputDate, total_blocks_received: 96, total_blocks_expected: 96,
      quality_status: 'PASSED', is_complete: true, freshness: 'STALE' });
    mocks.history.mockResolvedValue({ latest_observed_date: inputDate, latest_observed_complete: true,
      complete_days: [{ operating_date: inputDate, load_kw: Array(96).fill(1000) }] });
    mocks.analytics.mockResolvedValue({ ...liveFixture, site_id: siteId, operating_date: targetDate,
      forecast_target_date: targetDate, latest_input_date: inputDate, training_end_date: inputDate,
      freshness_days: 138, freshness: 'STALE' });
    mocks.admin.mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({
      order: async () => ({ data: priceRows, error: null }),
    }) }) }) }) }) });
  });

  it('runs April 30 to May 1 with exact verified 96-block prices and historical-only outputs', async () => {
    const response = await replayGet(request());
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ mode: 'HISTORICAL_REPLAY', label: REPLAY_LABEL, replay_input_date: inputDate,
      replay_target_date: targetDate, load_status: 'PASSED', model_validation_status: 'VALIDATED', price_status: 'READY',
      replay_ready: true, suppression_reason: null, actual_comparison_available: false });
    expect(body.forecast.provenance.mode).toBe('HISTORICAL_REPLAY');
    expect(body.forecast.blocks).toHaveLength(96);
    expect(body.forecast.recommendations_suppressed).toBe(true);
    expect(body.price_evidence.blocks).toHaveLength(96);
    expect(body.outputs.indicative_iex_energy_component_inr).toBeGreaterThan(0);
    expect(mocks.history).toHaveBeenCalledWith(bearerClient, siteId, 426, inputDate);
    expect(mocks.analytics).toHaveBeenCalledWith(expect.objectContaining({ historicalReplay: true, operatingDate: targetDate }));
    expect(mocks.authorize).toHaveBeenCalledWith(expect.anything(), { siteId, productId: 'GRID_INTELLIGENCE', requireBearer: true });
  });

  it('computes target-day actual errors only when 96 committed PASSED blocks exist', async () => {
    actualRows = liveFixture.blocks.map((block: { block_index: number; forecast_load_kw: number }) => ({
      block_index: block.block_index, load_kw: block.forecast_load_kw + 10, data_quality: 'PASSED',
    }));
    const body = await (await replayGet(request())).json();
    expect(body.actual_comparison_available).toBe(true);
    expect(body.actual_load_kw).toHaveLength(96);
    expect(body.outputs.actual_comparison.mae_kw).toBeCloseTo(10);
    actualRows[49].data_quality = 'FAILED';
    const unavailable = await (await replayGet(request())).json();
    expect(unavailable.actual_comparison_available).toBe(false);
    expect(unavailable.outputs.actual_comparison).toBeNull();
  });

  it('fails closed if the model trained after the selected historical input date', async () => {
    mocks.analytics.mockResolvedValueOnce({ ...liveFixture, site_id: siteId, operating_date: targetDate,
      forecast_target_date: targetDate, latest_input_date: inputDate, training_end_date: '2026-05-02',
      freshness_days: 138, freshness: 'STALE' });
    const response = await replayGet(request());
    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe('INVALID_REPLAY_ANALYTICS_CONTRACT');
  });

  it('reports a bearer history permission failure explicitly and never substitutes the server client', async () => {
    mocks.history.mockRejectedValueOnce(new Error('GRID_HISTORY_LOOKUP_FAILED: permission denied for table interval_data_96'));
    const response = await replayGet(request());
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe('REPLAY_HISTORY_PERMISSION_DENIED');
    expect(mocks.history).toHaveBeenCalledWith(bearerClient, siteId, 426, inputDate);
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.analytics).not.toHaveBeenCalled();
  });

  it('reports bearer-visible input missing from history as a consistency failure, not an absent day', async () => {
    mocks.history.mockResolvedValueOnce({ latest_observed_date: null, latest_observed_complete: false, complete_days: [] });
    const response = await replayGet(request());
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe('REPLAY_HISTORY_CONSISTENCY_FAILURE');
  });

  it('does not treat wall-clock stale evidence as replay failure, but exact price date and provenance are mandatory', async () => {
    priceRows = prices().map((row) => ({ ...row, delivery_date: '2026-05-02' }));
    expect((await (await replayGet(request())).json()).price_status).toBe('UNVERIFIED');
    priceRows = prices().slice(0, 95);
    expect((await (await replayGet(request())).json()).suppression_reason).toBe('EXACT_DATE_IEX_DAM_INCOMPLETE');
    priceRows = prices().map((row) => ({ ...row, verification_status: 'PENDING_CONFIRMATION' }));
    expect((await (await replayGet(request())).json()).suppression_reason).toBe('EXACT_DATE_IEX_DAM_UNVERIFIED');
  });

  it('rejects incomplete or failed-quality load before analytics or prices', async () => {
    mocks.input.mockResolvedValueOnce({ operating_date: inputDate, total_blocks_received: 95, total_blocks_expected: 96,
      quality_status: 'FAILED', is_complete: false, freshness: 'STALE' });
    const body = await (await replayGet(request())).json();
    expect(body).toMatchObject({ replay_ready: false, suppression_reason: 'INCOMPLETE_OR_FAILED_LOAD_DAY' });
    expect(mocks.analytics).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it('requires bearer, tenant/site entitlement and historical date before any replay work', async () => {
    expect((await replayGet(request(inputDate, siteId, false))).status).toBe(401);
    expect((await replayGet(request('2026-04-31'))).status).toBe(400);
    mocks.authorize.mockResolvedValueOnce({ authorized: false, response: NextResponse.json({ error: 'FOREIGN_SITE' }, { status: 403 }) });
    expect((await replayGet(request())).status).toBe(403);
    mocks.authorize.mockResolvedValueOnce({ authorized: false, response: NextResponse.json({ error: 'UNSUBSCRIBED' }, { status: 402 }) });
    expect((await replayGet(request())).status).toBe(402);
    expect(mocks.analytics).not.toHaveBeenCalled();
  });

  it('calculates actual comparison only from a real 96-block target day', () => {
    const priceEvidence = assessReplayPrices(prices(), targetDate);
    expect(priceEvidence.status).toBe('READY');
    const forecast = { ...liveFixture, site_id: siteId, operating_date: targetDate };
    expect(calculateReplayOutputs(forecast, priceEvidence.blocks, null).actual_comparison).toBeNull();
    const actual = forecast.blocks.map((block: { forecast_load_kw: number }) => block.forecast_load_kw + 10);
    const metrics = calculateReplayOutputs(forecast, priceEvidence.blocks, actual).actual_comparison!;
    expect(metrics.mae_kw).toBeCloseTo(10);
    expect(metrics.rmse_kw).toBeCloseTo(10);
    expect(metrics.smape_pct).toBeGreaterThan(0);
  });

  it('keeps LIVE default and labels every replay-derived card without a live recommendation', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/app/grid-intelligence/page.tsx'), 'utf8');
    const panel = readFileSync(resolve(process.cwd(), 'src/app/grid-intelligence/HistoricalReplayPanel.tsx'), 'utf8');
    expect(page).toContain("useState<'LIVE' | 'HISTORICAL_REPLAY'>('LIVE')");
    expect(page).toContain("mode !== 'LIVE'");
    expect(page).toContain("mode === 'HISTORICAL_REPLAY'");
    expect(panel).toContain('HISTORICAL BACKTEST');
    expect(panel).toContain('NOT LIVE OPERATIONAL ADVICE');
    expect(panel).toContain('result.replay_ready && result.outputs');
    expect(panel).not.toContain('landed electricity cost');
  });

  it('renders the real replay response as historical and keeps 96 forecast, actual and IEX MCP columns distinct', async () => {
    const previousActEnvironment = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    // JSDOM has no layout observer; Recharts' ResponsiveContainer requires one.
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const body = await (await replayGet(request())).json();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(HistoricalReplayPanel, { siteId, suggestedInputDate: inputDate })));
      expect(container.querySelector('[data-testid="historical-replay-banner"]')?.textContent).toContain('NOT LIVE OPERATIONAL ADVICE');
      await act(async () => (container.querySelector('[data-testid="run-historical-replay"]') as HTMLButtonElement).click());
      expect(container.querySelector('[data-testid="replay-historical-outputs"]')?.textContent).toContain(REPLAY_LABEL);
      expect(container.querySelector('[data-testid="replay-visualizations"]')?.textContent).toContain(REPLAY_LABEL);
      expect(container.querySelector('[data-testid="replay-model-tournament"]')?.textContent).toContain('WALK-FORWARD MODEL TOURNAMENT');
      expect(container.querySelector('[data-testid="replay-actual-unavailable"]')?.textContent).toContain('no actual series is drawn');
      const table = container.querySelector('[data-testid="replay-block-table"]');
      expect(table?.querySelectorAll('tbody tr')).toHaveLength(96);
      expect(table?.textContent).toContain('FORECAST kW');
      expect(table?.textContent).toContain('ACTUAL kW');
      expect(table?.textContent).toContain('IEX DAM MCP');
    } finally {
      await act(async () => root.unmount());
      container.remove();
      fetchMock.mockRestore();
      vi.unstubAllGlobals();
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  });
});
