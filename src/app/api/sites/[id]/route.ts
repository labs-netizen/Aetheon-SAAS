import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordAuditEvent } from '@/lib/audit';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const siteId = params.id;
  const authResult = await authorizeApiRequest(req, { siteId });
  if (!authResult.authorized) {
    return authResult.response;
  }

  const adminClient = createAdminClient();
  const { data: site, error } = await adminClient
    .from('sites')
    .select('*')
    .eq('id', siteId)
    .single();

  if (error || !site) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  }

  const { data: history } = await adminClient
    .from('site_activation_history')
    .select('*')
    .eq('site_id', siteId)
    .order('created_at', { ascending: false });

  return NextResponse.json({ site, activation_history: history || [] });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const siteId = params.id;
    const body = await req.json();

    // Authorize: Only Organisation Admin or Energy Manager can change site parameters
    const authResult = await authorizeApiRequest(req, {
      siteId,
      requiredRoles: ['ORGANISATION_ADMIN', 'ENERGY_MANAGER'],
    });

    if (!authResult.authorized) {
      return authResult.response;
    }

    const {
      name,
      state,
      discom,
      voltage_category,
      contract_demand_value,
      metering_point,
      load_class,
    } = body;

    // Disallow customer modification of activation status/lifecycle state
    if (
      body.activation_status !== undefined ||
      body.activation_reason !== undefined ||
      body.last_status_change !== undefined
    ) {
      return NextResponse.json(
        {
          error: 'CUSTOMER_ACTIVATION_FORBIDDEN',
          message:
            'Site activation status is governed solely by the server-side telemetry readiness engine and cannot be modified via customer site configuration.',
        },
        { status: 400 }
      );
    }

    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (name !== undefined) updates.name = name;
    if (state !== undefined) updates.state = state;
    if (discom !== undefined) updates.discom = discom;
    if (voltage_category !== undefined) updates.voltage_category = voltage_category;
    if (contract_demand_value !== undefined) updates.contract_demand_value = Number(contract_demand_value);
    if (metering_point !== undefined) updates.metering_point = metering_point;
    if (load_class !== undefined) updates.load_class = load_class;

    const adminClient = createAdminClient();
    const { data: updatedSite, error: rpcError } = await adminClient.rpc('update_site_config_atomic', {
      p_site_id: siteId,
      p_updates: updates,
      p_actor_id: authResult.user.id,
      p_actor_role: authResult.role,
      p_org_id: authResult.organisationId,
    });

    if (rpcError || !updatedSite) {
      console.error('Failed to atomically update site configuration and audit:', rpcError);
      return NextResponse.json(
        { error: 'DATABASE_ERROR', message: rpcError?.message || 'Failed to update site configuration in database.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Site configuration persisted successfully.',
      site: updatedSite,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
