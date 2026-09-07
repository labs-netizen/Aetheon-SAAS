import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const alertId = params.id;
    const adminClient = createAdminClient();

    // 1. Fetch alert to obtain siteId
    const { data: alert, error: fetchErr } = await adminClient
      .from('alerts')
      .select('*')
      .eq('id', alertId)
      .single();

    if (fetchErr || !alert) {
      return NextResponse.json(
        { error: 'ALERT_NOT_FOUND', message: 'Alert not found.' },
        { status: 404 }
      );
    }

    // 2. Authorize requester (OPERATOR, ENERGY_MANAGER, ORGANISATION_ADMIN)
    const authResult = await authorizeApiRequest(req, {
      siteId: alert.site_id,
      organisationId: alert.organisation_id,
      requiredRoles: ['OPERATOR', 'ENERGY_MANAGER', 'ORGANISATION_ADMIN'],
    });

    if (!authResult.authorized) {
      return authResult.response;
    }

    // 3. Persist acknowledgement to database
    const now = new Date().toISOString();
    const { data: updatedAlert, error: updateErr } = await adminClient
      .from('alerts')
      .update({
        status: 'ACKNOWLEDGED',
        acknowledged_by: authResult.user.id,
        acknowledged_at: now,
      })
      .eq('id', alertId)
      .select()
      .single();

    if (updateErr) {
      return NextResponse.json(
        { error: 'DATABASE_ERROR', message: updateErr.message },
        { status: 500 }
      );
    }

    // 4. Record audit event
    await adminClient.from('audit_logs').insert({
      organisation_id: alert.organisation_id,
      site_id: alert.site_id,
      actor_id: authResult.user.id,
      actor_role: authResult.role,
      action: 'ALERT_ACKNOWLEDGED',
      entity_type: 'ALERT',
      entity_id: alertId,
      details: {
        alert_title: alert.title,
        severity: alert.severity,
        module: alert.module,
      },
    });

    return NextResponse.json({
      success: true,
      alert: updatedAlert,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
