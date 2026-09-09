import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token } = body;

    if (typeof token !== 'string' || !token || token.length > 512) {
      return NextResponse.json(
        { error: 'token is required' },
        { status: 400 }
      );
    }

    const adminClient = createAdminClient();

    // 1. Authenticate accepting user (support both Bearer header and session cookie)
    let user: any = null;
    const authHeader = req.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const jwt = authHeader.replace('Bearer ', '');
      const { data: jwtUser, error: jwtErr } = await adminClient.auth.getUser(jwt);
      if (!jwtErr && jwtUser?.user) {
        user = jwtUser.user;
      }
    }

    if (!user) {
      const serverSupabase = createServerSupabaseClient();
      const { data: authData } = await serverSupabase.auth.getUser();
      user = authData?.user;
    }

    if (!user) {
      return NextResponse.json(
        { error: 'UNAUTHENTICATED', message: 'You must be logged in to accept an invitation.' },
        { status: 401 }
      );
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const { data: result, error } = await adminClient.rpc('accept_invitation_atomic', {
      p_token_hash: tokenHash,
      p_user_id: user.id,
    });
    if (error) {
      const code = error.message;
      const status = code.includes('INVALID_TOKEN') ? 404 : code.includes('EXPIRED') ? 410 :
        code.includes('EMAIL_BINDING') || code.includes('FORBIDDEN') || code.includes('MISMATCH') ? 403 :
        code.includes('ALREADY_USED') || code.includes('MEMBERSHIP_CONFLICT') ? 409 : 500;
      return NextResponse.json({ error: code }, { status });
    }
    return NextResponse.json({ success: true, organisationId: result.organisation_id, role: result.role,
      message: 'Invitation accepted.' });
  } catch (err) {
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
