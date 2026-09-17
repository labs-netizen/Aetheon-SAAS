import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';
import { operatingToday, validDate } from '@/lib/analytics/domain-safety';
import { requestBessSizing, validateSizingCandidates } from '@/lib/analytics/bess-sizing';
import { evaluateHistoricalBessSizingReadiness } from '@/lib/analytics/bess-sizing-evidence';

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
    const readiness=await evaluateHistoricalBessSizingReadiness({client:auth.authenticatedClient,priceClient:createAdminClient(),siteId,
      organisationId:auth.organisationId,targetDate,contractDemandKw:Number(auth.site.contract_demand_value)});
    if(!readiness.sizing_ready||!readiness.profile||!readiness.forecast){
      const {profile:_profile,forecast:_forecast,prices:_prices,...safeReadiness}=readiness;
      return NextResponse.json({error:readiness.reason_if_ineligible||'BESS_SIZING_UNAVAILABLE',readiness:safeReadiness},{status:422});
    }
    const result = await requestBessSizing({ siteId, targetDate, profile:readiness.profile, forecast:readiness.forecast,
      prices: readiness.prices,
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
