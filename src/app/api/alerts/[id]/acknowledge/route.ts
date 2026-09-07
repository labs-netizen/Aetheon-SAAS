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

    // 1. Fetch alert to obtain siteId and organisationId
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

    // 3. Use atomic RPC for acknowledgement + audit (all-or-nothing)
    const { data: result, error: rpcError } = await adminClient.rpc('acknowledge_alert_atomic', {
      p_alert_id: alertId,
      p_user_id: authResult.user.id,
      p_user_role: authResult.role,
      p_org_id: alert.organisation_id,
    });

    if (rpcError) {
      return NextResponse.json({ error: 'RPC_FAILED', message: rpcError.message }, { status: 500 });
    }

    // 4. Fetch updated alert for response
    const { data: updatedAlert, error: updateFetchErr } = await adminClient
      .from('alerts')
      .select('*')
      .eq('id', alertId)
      .single();

    if (updateFetchErr) {
      return NextResponse.json(
        { error: 'DATABASE_ERROR', message: updateFetchErr.message },
        { status: 500 }
      );
    }

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
