import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadGridHistoricalInput, resolveGridInputEvidence } from '@/lib/analytics/grid-input-evidence';
import { fetchGridForecast } from '@/lib/analytics/client';
import { operatingToday, validDate, validGridAnalyticsResponse } from '@/lib/analytics/domain-safety';
import { loadBessProfile } from '@/lib/analytics/bess-simulation';
import { requestBessSizing, validateSizingCandidates } from '@/lib/analytics/bess-sizing';

const nextDate = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const previousDate = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

export async function POST(req: NextRequest) {
  if (!req.headers.get('authorization')?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'AUTHENTICATED_SESSION_REQUIRED' }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'INVALID_SIZING_REQUEST' }, { status: 400 }); }
  const siteId = typeof body.site_id === 'string' ? body.site_id : '';
  if (Array.isArray(body.selected_target_dates) || Array.isArray(body.target_dates)) {
    return NextResponse.json({ error: 'ONE_HISTORICAL_TARGET_DATE_PER_REQUEST' }, { status: 400 });
  }
  const requestedTargetDate = body.target_date;
  const inputDate = validDate(requestedTargetDate) ? previousDate(requestedTargetDate) : body.input_date;
  const grid = validateSizingCandidates(body.capacity_candidates_kwh, body.power_candidates_kw);
  if (!siteId || !validDate(inputDate) || !grid) {
    return NextResponse.json({ error: 'INVALID_SIZING_REQUEST' }, { status: 400 });
  }
  const targetDate = nextDate(inputDate);
  if (validDate(requestedTargetDate) && requestedTargetDate !== targetDate) {
    return NextResponse.json({ error: 'INVALID_SIZING_REQUEST' }, { status: 400 });
  }
  if (targetDate >= operatingToday()) {
    return NextResponse.json({ error: 'HISTORICAL_TARGET_DATE_REQUIRED' }, { status: 400 });
  }
  const auth = await authorizeApiRequest(req, { siteId, productId: 'BESS_ARBITRAGE', requireBearer: true });
  if (!auth.authorized) return auth.response;
  if (!auth.authenticatedClient || auth.isDemo || !auth.site || auth.site.id !== siteId ||
      auth.site.organisation_id !== auth.organisationId) {
    return NextResponse.json({ error: 'SITE_ACCESS_DENIED' }, { status: 403 });
  }
  try {
    const client = auth.authenticatedClient;
    const evidence = await resolveGridInputEvidence(client, siteId, inputDate);
    if (!evidence.is_complete || evidence.quality_status !== 'PASSED') {
      return NextResponse.json({ error: 'COMPLETE_PASSED_96_BLOCK_INPUT_REQUIRED', input_evidence: evidence }, { status: 422 });
    }
    const history = await loadGridHistoricalInput(client, siteId, 426, inputDate);
    if (history.latest_observed_date !== inputDate || !history.latest_observed_complete ||
        history.complete_days.at(-1)?.operating_date !== inputDate) {
      return NextResponse.json({ error: 'SIZING_HISTORY_CONSISTENCY_FAILURE' }, { status: 500 });
    }
    const forecast = await fetchGridForecast({ isDemo: false, siteId, operatingDate: targetDate,
      contractDemandKw: Number(auth.site.contract_demand_value), historicalDays: history.complete_days,
      evaluationDate: operatingToday(), latestInputComplete: true, historicalReplay: true });
    if (!validGridAnalyticsResponse(forecast, siteId, targetDate, 'HISTORICAL_REPLAY') ||
        forecast.latest_input_date !== inputDate || forecast.forecast_target_date !== targetDate) {
      return NextResponse.json({ error: 'INVALID_SIZING_FORECAST_CONTRACT' }, { status: 502 });
    }
    if (!forecast.forecast_available || forecast.blocks.length !== 96) {
      return NextResponse.json({ error: forecast.suppression_reason || 'VALIDATED_96_BLOCK_FORECAST_REQUIRED' }, { status: 422 });
    }
    const profile = await loadBessProfile(client, siteId, auth.organisationId);
    if (!profile) return NextResponse.json({ error: 'BESS_PROFILE_REQUIRED' }, { status: 422 });

    const db = createAdminClient();
    const { data: priceRows, error: priceError } = await db.from('market_price_blocks')
      .select('block_index,mcp_rs_per_mwh,source_reference,source_file_hash,provenance_status,verification_status')
      .eq('exchange', 'IEX').eq('market_product', 'DAM').eq('delivery_date', targetDate).order('block_index');
    if (priceError) throw new Error(`BESS_SIZING_PRICE_LOOKUP_FAILED: ${priceError.message}`);
    const prices = priceRows || [];
    if (prices.length !== 96 || prices.some((row, index) => Number(row.block_index) !== index + 1 ||
        row.provenance_status !== 'OFFICIAL_SOURCE_CONFIRMED' || row.verification_status !== 'VERIFIED' ||
        !Number.isFinite(Number(row.mcp_rs_per_mwh)) || !row.source_reference || !row.source_file_hash)) {
      return NextResponse.json({ error: 'EXACT_DATE_VERIFIED_IEX_DAM_REQUIRED' }, { status: 422 });
    }
    const result = await requestBessSizing({ siteId, targetDate, profile, forecast,
      prices: prices as Array<{block_index:number;mcp_rs_per_mwh:number;source_reference:string;
        source_file_hash:string;provenance_status:string;verification_status:string}>,
      capacities: grid.capacities, powers: grid.powers });
    return NextResponse.json({ mode: 'HISTORICAL_BESS_SIZING', input_date: inputDate, target_date: targetDate, result });
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const denied = /permission denied|42501/i.test(details);
    console.error('BESS sizing failed', { siteId, inputDate, error: details });
    return NextResponse.json({ error: denied ? 'BESS_SIZING_EVIDENCE_ACCESS_DENIED' : 'BESS_SIZING_UNAVAILABLE' },
      { status: denied ? 403 : 502 });
  }
}
