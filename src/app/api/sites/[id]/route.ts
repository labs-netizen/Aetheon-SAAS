import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';

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

  return NextResponse.json({ site });
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
    if (body.activation_status !== undefined) updates.activation_status = body.activation_status;
    if (body.activation_reason !== undefined) updates.activation_reason = body.activation_reason;

    const adminClient = createAdminClient();
    const { data: updatedSite, error: updateError } = await adminClient
      .from('sites')
      .update(updates)
      .eq('id', siteId)
      .select()
      .single();

    if (updateError || !updatedSite) {
      console.error('Failed to update site parameters:', updateError);
      return NextResponse.json(
        { error: 'DATABASE_ERROR', message: 'Failed to update site configuration in database.' },
        { status: 500 }
      );
    }

    // Record audit log
    await adminClient.from('audit_logs').insert({
      actor_id: authResult.user.id,
      actor_role: authResult.role,
      organisation_id: authResult.organisationId,
      site_id: siteId,
      event_type: 'SITE_CONFIGURATION_UPDATED',
      event_payload: {
        updates,
        site_id: siteId,
      },
    });

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
