import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadGridHistoricalInput } from '@/lib/analytics/grid-input-evidence';
import { fetchGridForecast } from '@/lib/analytics/client';
import { operatingToday, validGridAnalyticsResponse } from '@/lib/analytics/domain-safety';
import { runBessSimulation } from '@/lib/analytics/bess-simulation';

const nextDate = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

export async function GET(req: NextRequest) {
  const siteId = new URL(req.url).searchParams.get('site_id');
  if (!siteId) return NextResponse.json({ error: 'SITE_ID_REQUIRED' }, { status: 400 });
  const auth = await authorizeApiRequest(req, { siteId, productId: 'BESS_ARBITRAGE', requireBearer: true });
  if (!auth.authorized) return auth.response;
  if (auth.isDemo) return NextResponse.json({ status: 'SUPPRESSED', suppression_reason: 'LIVE_AUTHORITATIVE_EVIDENCE_REQUIRED' });
  try {
    const admin = createAdminClient();
    const { data: site, error } = await admin.from('sites').select('id,organisation_id,contract_demand_value,is_demo')
      .eq('id', siteId).maybeSingle();
    if (error) return NextResponse.json({ error: 'SITE_LOOKUP_FAILED', details: error.message }, { status: 500 });
    if (!site || site.organisation_id !== auth.organisationId || site.is_demo) return NextResponse.json({ error: 'SITE_ORGANISATION_MISMATCH' }, { status: 403 });
    const history = await loadGridHistoricalInput(admin, siteId);
    const latest = history.complete_days.at(-1)?.operating_date;
    if (!latest) return NextResponse.json({ status: 'SUPPRESSED', suppression_reason: 'COMPLETE_96_BLOCK_HISTORY_REQUIRED' });
    const targetDate = nextDate(latest);
    const forecast = await fetchGridForecast({ siteId, operatingDate: targetDate,
      contractDemandKw: Number(site.contract_demand_value), historicalDays: history.complete_days,
      evaluationDate: operatingToday(), latestInputComplete: history.latest_observed_complete });
    if (!validGridAnalyticsResponse(forecast, siteId, targetDate)) {
      return NextResponse.json({ error: 'INVALID_ANALYTICS_CONTRACT' }, { status: 502 });
    }
    const simulation = await runBessSimulation({ client: admin, siteId, organisationId: auth.organisationId,
      targetDate, forecast, historicalReplay: false });
    return NextResponse.json({ mode: 'LIVE_ADVISORY', input_date: latest, target_date: targetDate,
      forecast_status: forecast.forecast_status, simulation });
  } catch (error) {
    return NextResponse.json({ error: 'BESS_SIMULATION_UNAVAILABLE', details: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
