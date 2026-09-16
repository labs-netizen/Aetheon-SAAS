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
  const input = body?.profile || {};
  const profile = validateBessProfile({ ...input,
    nameplate_energy_capacity_kwh: input.nameplate_energy_capacity_kwh ?? input.capacity_kwh,
    minimum_soc_percent: input.minimum_soc_percent ?? input.min_soc_percent,
    maximum_soc_percent: input.maximum_soc_percent ?? input.max_soc_percent,
    final_soc_percent: input.final_soc_percent ?? input.minimum_final_soc_percent ?? null,
    available_blocks: input.available_blocks ?? null,
    site_id: siteId, organisation_id: auth.organisationId, is_active: true });
  if (!profile) return NextResponse.json({ error: 'BESS_PROFILE_VALIDATION_FAILED' }, { status: 422 });
  const { data, error } = await createAdminClient().rpc('upsert_site_bess_simulation_profile', {
    p_actor_id: auth.user.id, p_actor_role: auth.role, p_organisation_id: auth.organisationId,
    p_site_id: siteId, p_profile: profile,
  });
  if (error || !data) {
    console.error('BESS profile RPC failed', { siteId, organisationId: auth.organisationId, actorId: auth.user.id,
      code: error?.code, message: error?.message, details: error?.details, hint: error?.hint });
    if (error?.code === '42501' || /BESS_PROFILE_AUTHORITY_DENIED|permission denied/i.test(error?.message || '')) {
      return NextResponse.json({ error: 'BESS_PROFILE_WRITE_DENIED' }, { status: 403 });
    }
    return NextResponse.json({ error: 'BESS_PROFILE_RPC_FAILED' }, { status: 500 });
  }
  return NextResponse.json({ configured: true, profile: data, suppression_reason: null });
}
