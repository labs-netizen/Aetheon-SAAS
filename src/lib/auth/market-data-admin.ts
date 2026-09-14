import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function authorizeMarketDataAdmin(req: NextRequest) {
  const authorization = req.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return { authorized: false as const, response: NextResponse.json({ error: 'AUTHENTICATED_BEARER_REQUIRED' }, { status: 401 }) };
  }
  const adminClient = createAdminClient();
  const { data: { user }, error } = await adminClient.auth.getUser(authorization.slice(7));
  if (error || !user) return { authorized: false as const, response: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) };
  const [{ data: profile }, { data: membership }] = await Promise.all([
    adminClient.from('user_profiles').select('is_platform_admin').eq('id', user.id).maybeSingle(),
    adminClient.from('memberships').select('role,is_active,expires_at').eq('user_id', user.id).eq('is_active', true).eq('role', 'AETHEON_ANALYST').maybeSingle(),
  ]);
  const analystValid = membership?.role === 'AETHEON_ANALYST' && membership.expires_at && new Date(membership.expires_at) > new Date();
  if (!profile?.is_platform_admin && !analystValid) {
    return { authorized: false as const, response: NextResponse.json({ error: 'PLATFORM_MARKET_DATA_ADMIN_REQUIRED' }, { status: 403 }) };
  }
  return { authorized: true as const, actorId: user.id, adminClient };
}
