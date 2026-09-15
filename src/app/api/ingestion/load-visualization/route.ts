import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { validDate } from '@/lib/analytics/domain-safety';
import { LOAD_VISUAL_WINDOWS, loadCommittedVisualization, type LoadVisualWindow } from '@/lib/analytics/load-visualization';

export async function GET(req: NextRequest) {
  if (!req.headers.get('authorization')?.startsWith('Bearer '))
    return NextResponse.json({ error: 'AUTHENTICATED_BEARER_REQUIRED' }, { status: 401 });
  const params = new URL(req.url).searchParams;
  const siteId = params.get('site_id');
  const date = params.get('operating_date');
  const days = Number(params.get('window_days') || '30');
  if (!siteId || (date !== null && !validDate(date)) || !LOAD_VISUAL_WINDOWS.includes(days as LoadVisualWindow))
    return NextResponse.json({ error: 'INVALID_LOAD_VISUALIZATION_REQUEST' }, { status: 400 });
  const auth = await authorizeApiRequest(req, { siteId, requireBearer: true });
  if (!auth.authorized) return auth.response;
  if (!auth.authenticatedClient || auth.isDemo)
    return NextResponse.json({ error: 'LIVE_TENANT_BEARER_REQUIRED' }, { status: 403 });
  const client = auth.authenticatedClient;
  const { data: site, error: siteError } = await client.from('sites')
    .select('id,organisation_id,contract_demand_value,contract_demand_unit').eq('id', siteId).maybeSingle();
  if (siteError) return NextResponse.json({ error: 'SITE_LOOKUP_FAILED', details: siteError.message }, { status: 500 });
  if (!site || site.organisation_id !== auth.organisationId)
    return NextResponse.json({ error: 'SITE_ORGANISATION_MISMATCH' }, { status: 403 });
  try {
    const result = await loadCommittedVisualization(client, siteId, days as LoadVisualWindow, date,
      Number(site.contract_demand_value), site.contract_demand_unit);
    return NextResponse.json({ site_id: siteId, source: 'COMMITTED_INTERVAL_DATA_96', ...result },
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json({ error: 'LOAD_VISUALIZATION_LOOKUP_FAILED',
      details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
