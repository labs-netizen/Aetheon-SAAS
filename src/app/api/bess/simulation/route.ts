import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadGridHistoricalInput } from '@/lib/analytics/grid-input-evidence';
import { fetchGridForecast } from '@/lib/analytics/client';
import { operatingToday, validGridAnalyticsResponse } from '@/lib/analytics/domain-safety';
import { runBessSimulation } from '@/lib/analytics/bess-simulation';

const nextDate = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

export async function GET(req: NextRequest) {
  if (!req.headers.get('authorization')?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'AUTHENTICATED_SESSION_REQUIRED' }, { status: 401 });
  }
  const siteId = new URL(req.url).searchParams.get('site_id');
  if (!siteId) return NextResponse.json({ error: 'SITE_ID_REQUIRED' }, { status: 400 });
  const auth = await authorizeApiRequest(req, { siteId, productId: 'BESS_ARBITRAGE', requireBearer: true });
  if (!auth.authorized) return auth.response;
  if (auth.isDemo) return NextResponse.json({ status: 'SUPPRESSED', suppression_reason: 'LIVE_AUTHORITATIVE_EVIDENCE_REQUIRED' });
  if (!auth.authenticatedClient || !auth.site || auth.site.id !== siteId || auth.site.organisation_id !== auth.organisationId) {
    return NextResponse.json({ error: 'SITE_ACCESS_DENIED' }, { status: 403 });
  }
  try {
    const admin = createAdminClient();
    const history = await loadGridHistoricalInput(auth.authenticatedClient, siteId);
    const latest = history.complete_days.at(-1)?.operating_date;
    if (!latest) return NextResponse.json({ status: 'SUPPRESSED', suppression_reason: 'COMPLETE_96_BLOCK_HISTORY_REQUIRED' });
    const targetDate = nextDate(latest);
    const forecast = await fetchGridForecast({ siteId, operatingDate: targetDate,
      contractDemandKw: Number(auth.site.contract_demand_value), historicalDays: history.complete_days,
      evaluationDate: operatingToday(), latestInputComplete: history.latest_observed_complete });
    if (!validGridAnalyticsResponse(forecast, siteId, targetDate)) {
      return NextResponse.json({ error: 'INVALID_ANALYTICS_CONTRACT' }, { status: 502 });
    }
    const simulation = await runBessSimulation({ client: auth.authenticatedClient, priceClient: admin,
      siteId, organisationId: auth.organisationId, targetDate, forecast, historicalReplay: false });
    return NextResponse.json({ mode: 'LIVE_ADVISORY', input_date: latest, target_date: targetDate,
      forecast_status: forecast.forecast_status, simulation });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reason = /permission denied|42501/i.test(message) ? 'BESS_EVIDENCE_ACCESS_DENIED' : 'BESS_SIMULATION_UNAVAILABLE';
    return NextResponse.json({ error: reason }, { status: /permission denied|42501/i.test(message) ? 403 : 502 });
  }
}
