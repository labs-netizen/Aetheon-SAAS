import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { operatingToday, validDate, validGridAnalyticsResponse } from '@/lib/analytics/domain-safety';
import { loadGridHistoricalInput, resolveGridInputEvidence } from '@/lib/analytics/grid-input-evidence';
import { fetchGridForecast } from '@/lib/analytics/client';
import { calculateReplayOutputs, assessReplayPrices, REPLAY_LABEL, type ReplayPriceRow } from '@/lib/analytics/grid-replay';
import { createAdminClient } from '@/lib/supabase/admin';

const nextDate = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

export async function GET(req: NextRequest) {
  if (!req.headers.get('authorization')?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'AUTHENTICATED_BEARER_REQUIRED' }, { status: 401 });
  }
  const params = new URL(req.url).searchParams;
  const siteId = params.get('site_id');
  const inputDate = params.get('operating_date');
  if (!siteId || !validDate(inputDate)) return NextResponse.json({ error: 'INVALID_REPLAY_REQUEST' }, { status: 400 });
  const targetDate = nextDate(inputDate);
  if (targetDate >= operatingToday()) return NextResponse.json({ error: 'HISTORICAL_TARGET_DATE_REQUIRED' }, { status: 400 });

  const auth = await authorizeApiRequest(req, { siteId, productId: 'GRID_INTELLIGENCE' });
  if (!auth.authorized) return auth.response;
  if (!auth.authenticatedClient || auth.isDemo) return NextResponse.json({ error: 'LIVE_TENANT_BEARER_REQUIRED' }, { status: 403 });
  const client = auth.authenticatedClient;
  const base = { mode: 'HISTORICAL_REPLAY', label: REPLAY_LABEL, site_id: siteId,
    organisation_id: auth.organisationId, replay_input_date: inputDate, replay_target_date: targetDate };
  const suppressed = (reason: string, fields: Record<string, unknown> = {}) => NextResponse.json({
    ...base, load_status: 'NOT_EVALUATED', model_validation_status: 'NOT_EVALUATED', price_status: 'NOT_EVALUATED',
    replay_ready: false, suppression_reason: reason, forecast: null, price_evidence: null, outputs: null,
    actual_comparison_available: false, ...fields,
  });

  try {
    const { data: site, error: siteError } = await client.from('sites')
      .select('id,organisation_id,is_demo,contract_demand_value').eq('id', siteId).maybeSingle();
    if (siteError) return NextResponse.json({ error: 'SITE_LOOKUP_FAILED', details: siteError.message }, { status: 500 });
    if (!site || site.organisation_id !== auth.organisationId || site.is_demo) {
      return NextResponse.json({ error: 'SITE_ORGANISATION_MISMATCH' }, { status: 403 });
    }
    const input = await resolveGridInputEvidence(client, siteId, inputDate);
    const loadStatus = input.is_complete && input.quality_status === 'PASSED' ? 'PASSED' : 'INCOMPLETE_OR_FAILED_QUALITY';
    if (loadStatus !== 'PASSED') return suppressed('INCOMPLETE_OR_FAILED_LOAD_DAY', { load_status: loadStatus, input_evidence: input });

    // The bearer client proves ownership of D. Bulk history is then read by the
    // server-only client, scoped to that checked site and capped at D.
    const db = createAdminClient();
    const history = await loadGridHistoricalInput(db, siteId, 426, inputDate);
    if (history.latest_observed_date !== inputDate || !history.latest_observed_complete ||
        history.complete_days.at(-1)?.operating_date !== inputDate) {
      return suppressed('SELECTED_LOAD_DAY_NOT_IN_VALID_HISTORY', { load_status: loadStatus, input_evidence: input });
    }
    const forecast = await fetchGridForecast({ isDemo: false, siteId, operatingDate: targetDate,
      contractDemandKw: Number(site.contract_demand_value), historicalDays: history.complete_days,
      evaluationDate: operatingToday(), latestInputComplete: true, historicalReplay: true });
    if (!validGridAnalyticsResponse(forecast, siteId, targetDate, 'HISTORICAL_REPLAY') ||
        forecast.latest_input_date !== inputDate || forecast.forecast_target_date !== targetDate ||
        !forecast.training_start_date || !forecast.training_end_date || forecast.training_end_date > inputDate ||
        forecast.training_start_date > forecast.training_end_date) {
      return NextResponse.json({ error: 'INVALID_REPLAY_ANALYTICS_CONTRACT' }, { status: 502 });
    }
    const historicalForecast = { ...forecast, provenance: { ...forecast.provenance, mode: 'HISTORICAL_REPLAY' },
      mode: 'HISTORICAL_REPLAY', recommendations_suppressed: true };
    if (!forecast.forecast_available) return suppressed(forecast.suppression_reason || 'MODEL_NOT_VALIDATED', {
      load_status: loadStatus, model_validation_status: forecast.validation_status,
      input_evidence: input, forecast: historicalForecast,
    });

    const { data: priceRows, error: priceError } = await db.from('market_price_blocks')
      .select('delivery_date,block_index,time_start,time_end,mcp_rs_per_mwh,source_type,source_reference,source_file_hash,provenance_status,verification_status')
      .eq('exchange', 'IEX').eq('market_product', 'DAM').eq('delivery_date', targetDate).order('block_index');
    if (priceError) return NextResponse.json({ error: 'PRICE_LOOKUP_FAILED', details: priceError.message }, { status: 500 });
    const prices = assessReplayPrices((priceRows || []) as ReplayPriceRow[], targetDate);
    const priceEvidence = { delivery_date: targetDate, expected_blocks: 96, received_blocks: priceRows?.length || 0,
      status: prices.status, provenance_status: prices.status === 'READY' ? 'OFFICIAL_SOURCE_CONFIRMED' : null,
      verification_status: prices.status === 'READY' ? 'VERIFIED' : null, blocks: prices.blocks };
    if (prices.status !== 'READY') return suppressed(`EXACT_DATE_IEX_DAM_${prices.status}`, {
      load_status: loadStatus, model_validation_status: forecast.validation_status,
      price_status: prices.status, input_evidence: input, forecast: historicalForecast, price_evidence: priceEvidence,
    });

    const { data: actualRows, error: actualError } = await client.from('interval_data_96')
      .select('block_index,load_kw,data_quality').eq('site_id', siteId).eq('operating_date', targetDate).order('block_index');
    if (actualError) return NextResponse.json({ error: 'ACTUAL_LOAD_LOOKUP_FAILED', details: actualError.message }, { status: 500 });
    const actual = actualRows?.length === 96 && actualRows.every((row, index) =>
      Number(row.block_index) === index + 1 && row.data_quality === 'PASSED' && row.load_kw !== null &&
      Number.isFinite(Number(row.load_kw)) && Number(row.load_kw) >= 0)
      ? actualRows.map((row) => Number(row.load_kw)) : null;
    const outputs = calculateReplayOutputs(forecast, prices.blocks, actual);
    return NextResponse.json({ ...base, load_status: loadStatus, model_validation_status: forecast.validation_status,
      price_status: 'READY', replay_ready: true, suppression_reason: null, input_evidence: input,
      forecast: historicalForecast, price_evidence: priceEvidence, outputs,
      actual_comparison_available: actual !== null,
      actual_load_kw: actual,
    });
  } catch (error) {
    return NextResponse.json({ error: 'HISTORICAL_REPLAY_UNAVAILABLE', details: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
