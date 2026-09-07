import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      organisationId,
      name,
      state,
      discom,
      voltageCategory,
      voltage_category,
      contractDemandValue,
      contract_demand_value,
      contractDemandUnit,
      contract_demand_unit,
      meteringPoint,
      metering_point,
      loadClass,
      load_class,
    } = body;

    const effectiveVoltage = voltageCategory || voltage_category || '33kV';
    const effectiveDemand = Number(contractDemandValue || contract_demand_value || 1000);
    const effectiveUnit = contractDemandUnit || contract_demand_unit || 'kVA';
    const effectiveMetering = meteringPoint || metering_point || 'Main 33kV Incomer Feeder';
    const effectiveLoadClass = loadClass || load_class || 'Industrial C&I';

    if (!organisationId || !name || !state || !discom) {
      return NextResponse.json(
        {
          error: 'MISSING_FIELDS',
          message: 'organisationId, name, state, and discom are required to initialize a site.',
        },
        { status: 400 }
      );
    }

    if (isNaN(effectiveDemand) || effectiveDemand <= 0) {
      return NextResponse.json(
        {
          error: 'INVALID_DEMAND',
          message: 'Contract demand must be a positive numeric value.',
        },
        { status: 400 }
      );
    }

    // 1. Authorize: Only authenticated ORGANISATION_ADMIN of the owning organisation can create sites
    const authResult = await authorizeApiRequest(req, {
      organisationId,
      requiredRoles: ['ORGANISATION_ADMIN'],
    });

    if (!authResult.authorized) {
      return authResult.response;
    }

    const adminClient = createAdminClient();

    // 2. Insert new site record with CONFIGURED activation status
    const { data: site, error: siteError } = await adminClient
      .from('sites')
      .insert({
        organisation_id: organisationId,
        name: name.trim(),
        state: state.trim(),
        discom: discom.trim(),
        voltage_category: effectiveVoltage,
        contract_demand_value: effectiveDemand,
        contract_demand_unit: effectiveUnit,
        metering_point: effectiveMetering.trim(),
        load_class: effectiveLoadClass.trim(),
        timezone: 'Asia/Kolkata',
        activation_status: 'CONFIGURED',
        activation_reason: 'Initial site electrical profile configured',
        is_demo: authResult.isDemo,
      })
      .select()
      .single();

    if (siteError) {
      console.error('Failed to create site:', siteError);
      return NextResponse.json(
        { error: 'DATABASE_ERROR', message: siteError.message },
        { status: 500 }
      );
    }

    // 3. Grant site access to the creating user
    const { error: accessError } = await adminClient
      .from('site_access')
      .insert({
        site_id: site.id,
        user_id: authResult.user.id,
        granted_by: authResult.user.id,
      })
      .select()
      .maybeSingle();

    if (accessError) {
      console.warn('Site access grant notice:', accessError.message);
    }

    // 4. Initial Site Activation History Record
    await adminClient
      .from('site_activation_history')
      .insert({
        site_id: site.id,
        previous_status: 'UNCONFIGURED',
        new_status: 'CONFIGURED',
        reason: 'Site electrical parameters initialized via onboarding wizard',
        changed_by: authResult.user.id,
      });

    return NextResponse.json(
      {
        success: true,
        site,
        message: 'Industrial site configured and registered successfully.',
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('Site creation error:', err);
    return NextResponse.json(
      {
        error: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
