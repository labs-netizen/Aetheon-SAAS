import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { validateFlexibilityProfile } from '@/lib/analytics/grid-flexibility';
import { createAdminClient } from '@/lib/supabase/admin';

const profileFields = 'site_id,organisation_id,flexible_load_kw,maximum_shift_energy_kwh_per_day,maximum_upward_shift_kw_per_block,maximum_downward_shift_kw_per_block,earliest_shift_block,latest_shift_block,maximum_shift_duration_blocks,critical_blocks,energy_conservation_required,minimum_operating_load_kw,maximum_operating_load_kw,is_active,updated_at';

export async function GET(req: NextRequest) {
  const siteId = new URL(req.url).searchParams.get('site_id');
  if (!siteId) return NextResponse.json({ error: 'SITE_ID_REQUIRED' }, { status: 400 });
  const auth = await authorizeApiRequest(req, { siteId, productId: 'GRID_INTELLIGENCE', requireBearer: true });
  if (!auth.authorized) return auth.response;
  if (!auth.authenticatedClient) return NextResponse.json({ error: 'AUTHENTICATED_BEARER_REQUIRED' }, { status: 401 });
  const { data, error } = await auth.authenticatedClient.from('site_flexibility_profiles')
    .select(profileFields).eq('site_id', siteId).maybeSingle();
  if (error) return NextResponse.json({ error: 'FLEXIBILITY_PROFILE_LOOKUP_FAILED', details: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ configured: false, profile: null, suppression_reason: 'FLEXIBILITY_PROFILE_REQUIRED' });
  const profile = validateFlexibilityProfile(data);
  if (!profile || profile.organisation_id !== auth.organisationId) {
    return NextResponse.json({ configured: false, profile: null, suppression_reason: 'INVALID_FLEXIBILITY_PROFILE' });
  }
  return NextResponse.json({ configured: true, profile, suppression_reason: null });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const siteId = body?.site_id;
  if (!siteId) return NextResponse.json({ error: 'SITE_ID_REQUIRED' }, { status: 400 });
  const auth = await authorizeApiRequest(req, { siteId, productId: 'GRID_INTELLIGENCE', requireBearer: true,
    requiredRoles: ['ORGANISATION_ADMIN', 'ENERGY_MANAGER'] });
  if (!auth.authorized) return auth.response;
  const candidate = validateFlexibilityProfile({ ...body.profile, site_id: siteId,
    organisation_id: auth.organisationId, is_active: true });
  if (!candidate) return NextResponse.json({ error: 'INVALID_FLEXIBILITY_PROFILE' }, { status: 400 });
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('upsert_site_flexibility_profile', {
    p_actor_id: auth.user.id, p_actor_role: auth.role, p_organisation_id: auth.organisationId,
    p_site_id: siteId, p_profile: candidate,
  });
  if (error || !data) return NextResponse.json({ error: 'FLEXIBILITY_PROFILE_SAVE_FAILED', details: error?.message }, { status: 500 });
  return NextResponse.json({ configured: true, profile: data, suppression_reason: null });
}
