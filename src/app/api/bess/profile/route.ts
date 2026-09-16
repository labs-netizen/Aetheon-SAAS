import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadBessProfile, validateBessProfile } from '@/lib/analytics/bess-simulation';

export async function GET(req: NextRequest) {
  const siteId = new URL(req.url).searchParams.get('site_id');
  if (!siteId) return NextResponse.json({ error: 'SITE_ID_REQUIRED' }, { status: 400 });
  const auth = await authorizeApiRequest(req, { siteId, productId: 'BESS_ARBITRAGE', requireBearer: true });
  if (!auth.authorized) return auth.response;
  if (!auth.authenticatedClient) return NextResponse.json({ error: 'AUTHENTICATED_BEARER_REQUIRED' }, { status: 401 });
  try {
    const profile = await loadBessProfile(auth.authenticatedClient, siteId, auth.organisationId);
    return NextResponse.json({ configured: Boolean(profile), profile, suppression_reason: profile ? null : 'BESS_PROFILE_REQUIRED' });
  } catch (error) {
    return NextResponse.json({ error: 'BESS_PROFILE_LOOKUP_FAILED', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null); const siteId = body?.site_id;
  if (!siteId) return NextResponse.json({ error: 'SITE_ID_REQUIRED' }, { status: 400 });
  const auth = await authorizeApiRequest(req, { siteId, productId: 'BESS_ARBITRAGE', requireBearer: true,
    requiredRoles: ['ORGANISATION_ADMIN','ENERGY_MANAGER'] });
  if (!auth.authorized) return auth.response;
  const profile = validateBessProfile({ ...body.profile, site_id: siteId, organisation_id: auth.organisationId, is_active: true });
  if (!profile) return NextResponse.json({ error: 'INVALID_BESS_PROFILE' }, { status: 400 });
  const { data, error } = await createAdminClient().rpc('upsert_site_bess_simulation_profile', {
    p_actor_id: auth.user.id, p_actor_role: auth.role, p_organisation_id: auth.organisationId,
    p_site_id: siteId, p_profile: profile,
  });
  if (error || !data) return NextResponse.json({ error: 'BESS_PROFILE_SAVE_FAILED', details: error?.message }, { status: 500 });
  return NextResponse.json({ configured: true, profile: data, suppression_reason: null });
}
