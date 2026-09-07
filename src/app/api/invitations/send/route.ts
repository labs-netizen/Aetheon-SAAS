import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';
import crypto from 'crypto';

const ALLOWED_INVITE_ROLES = [
  'ORGANISATION_ADMIN',
  'ENERGY_MANAGER',
  'OPERATOR',
  'FINANCE_SUSTAINABILITY_VIEWER',
];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { organisationId, email, role, siteId } = body;

    if (!organisationId || !email || !role) {
      return NextResponse.json(
        { error: 'organisationId, email, and role are required' },
        { status: 400 }
      );
    }

    // 1. Authorize: Only Organisation Admin can send invitations
    const authResult = await authorizeApiRequest(req, {
      organisationId,
      requiredRoles: ['ORGANISATION_ADMIN'],
    });

    if (!authResult.authorized) {
      return authResult.response;
    }

    // 2. Reject internal Aetheon roles
    if (!ALLOWED_INVITE_ROLES.includes(role)) {
      return NextResponse.json(
        {
          error: 'FORBIDDEN_ROLE',
          message: `Organisation administrators cannot invite internal roles (${role}). Only customer roles are allowed.`,
        },
        { status: 403 }
      );
    }

    const adminClient = createAdminClient();
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // 3. Create invitation record
    const { data: invitation, error: inviteErr } = await adminClient
      .from('organisation_invitations')
      .insert({
        organisation_id: organisationId,
        email: email.toLowerCase().trim(),
        role,
        site_id: siteId || null,
        token,
        invited_by: authResult.user.id,
        status: 'PENDING',
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (inviteErr || !invitation) {
      console.error('Failed to create invitation:', inviteErr);
      return NextResponse.json(
        { error: 'DATABASE_ERROR', message: 'Failed to record invitation.' },
        { status: 500 }
      );
    }

    // 4. Record audit log
    await adminClient.from('audit_logs').insert({
      actor_id: authResult.user.id,
      actor_role: authResult.role,
      organisation_id: organisationId,
      event_type: 'INVITATION_CREATED',
      event_payload: {
        invitationId: invitation.id,
        recipientEmail: email,
        intendedRole: role,
        siteId: siteId || null,
      },
    });

    return NextResponse.json({
      success: true,
      message: `Invitation generated for ${email} as ${role}.`,
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        token: invitation.token,
        expiresAt: invitation.expires_at,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
