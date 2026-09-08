import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordAuditEvent } from '@/lib/audit';
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
    const auditRes = await recordAuditEvent(adminClient, {
      actor_id: authResult.user.id,
      actor_role: authResult.role,
      organisation_id: organisationId,
      site_id: siteId || undefined,
      action: 'INVITATION_CREATED',
      entity_type: 'INVITATION',
      entity_id: invitation.id,
      details: {
        invitationId: invitation.id,
        recipientEmail: email,
        intendedRole: role,
        siteId: siteId || null,
      },
    });

    if (!auditRes.success) {
      console.error('Failed to record invitation audit log:', auditRes.error);
      return NextResponse.json(
        { error: 'AUDIT_RECORDING_FAILED', message: 'Invitation created but audit log failed.' },
        { status: 500 }
      );
    }

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
