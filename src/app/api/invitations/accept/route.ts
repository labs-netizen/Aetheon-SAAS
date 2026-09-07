import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token } = body;

    if (!token) {
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

    // 2. Fetch invitation by token or token_hash
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    let { data: invitation, error: inviteErr } = await adminClient
      .from('organisation_invitations')
      .select('*')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (!invitation) {
      const tokenLookup = await adminClient
        .from('organisation_invitations')
        .select('*')
        .eq('token', token)
        .maybeSingle();
      invitation = tokenLookup.data;
      inviteErr = tokenLookup.error;
    }

    if (inviteErr || !invitation) {
      return NextResponse.json(
        { error: 'INVALID_TOKEN', message: 'Invitation not found or invalid token.' },
        { status: 404 }
      );
    }

    // Section 17: Strict email binding verification
    if (user.email?.toLowerCase() !== invitation.email?.toLowerCase()) {
      return NextResponse.json(
        {
          error: 'This invitation was issued to a different email address',
          message: `This invitation was issued to '${invitation.email}', but you are signed in as '${user.email}'.`,
        },
        { status: 403 }
      );
    }

    if (invitation.status !== 'PENDING') {
      return NextResponse.json(
        { error: 'ALREADY_USED', message: `Invitation is already ${invitation.status.toLowerCase()}.` },
        { status: 400 }
      );
    }

    if (new Date(invitation.expires_at).getTime() < Date.now()) {
      await adminClient
        .from('organisation_invitations')
        .update({ status: 'EXPIRED' })
        .eq('id', invitation.id);

      return NextResponse.json(
        { error: 'EXPIRED', message: 'This invitation has expired.' },
        { status: 410 }
      );
    }

    // 3. Create or update membership with the assigned role
    const { error: memErr } = await adminClient
      .from('memberships')
      .upsert(
        {
          organisation_id: invitation.organisation_id,
          user_id: user.id,
          role: invitation.role,
          is_active: true,
        },
        { onConflict: 'organisation_id,user_id' }
      );

    if (memErr) {
      console.error('Failed to create membership from invitation:', memErr);
      return NextResponse.json(
        { error: 'DATABASE_ERROR', message: 'Failed to assign organisation membership.' },
        { status: 500 }
      );
    }

    // 4. Create site access matching actual table schema (no is_active column)
    if (invitation.site_id) {
      await adminClient
        .from('site_access')
        .upsert(
          {
            site_id: invitation.site_id,
            user_id: user.id,
            granted_by: invitation.invited_by || user.id,
          },
          { onConflict: 'site_id,user_id' }
        );
    }

    // 5. Update invitation status to ACCEPTED
    await adminClient
      .from('organisation_invitations')
      .update({ status: 'ACCEPTED' })
      .eq('id', invitation.id);

    // 6. Record audit log matching actual database schema
    await adminClient.from('audit_logs').insert({
      actor_id: user.id,
      actor_role: invitation.role,
      organisation_id: invitation.organisation_id,
      action: 'INVITATION_ACCEPTED',
      entity_type: 'INVITATION',
      entity_id: invitation.id,
      details: {
        email: invitation.email,
        role: invitation.role,
        siteId: invitation.site_id,
      },
    });

    return NextResponse.json({
      success: true,
      message: `Invitation accepted. You have joined the organisation with role ${invitation.role}.`,
      organisationId: invitation.organisation_id,
      role: invitation.role,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
