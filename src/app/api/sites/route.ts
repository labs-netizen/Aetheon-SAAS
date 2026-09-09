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

    const rawVoltage = voltageCategory || voltage_category;
    const rawDemand = contractDemandValue !== undefined ? contractDemandValue : contract_demand_value;
    const rawMetering = meteringPoint || metering_point;

    if (!organisationId || !name || !state || !discom) {
      return NextResponse.json(
        {
          error: 'MISSING_FIELDS',
          message: 'organisationId, name, state, and discom are required to initialize a site.',
        },
        { status: 400 }
      );
    }

    if (!rawVoltage || rawDemand === undefined || rawDemand === null || !rawMetering) {
      return NextResponse.json(
        {
          error: 'MISSING_ELECTRICAL_FIELDS',
          message: 'voltage category, contract demand, and metering point are mandatory electrical configuration fields.',
        },
        { status: 400 }
      );
    }

    const effectiveVoltage = String(rawVoltage).trim();
    const effectiveDemand = Number(rawDemand);
    const effectiveUnit = contractDemandUnit || contract_demand_unit || 'kVA';
    const effectiveMetering = String(rawMetering).trim();
    const effectiveLoadClass = (loadClass || load_class || 'Industrial C&I').trim();

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

    // The site, creator grant, activation history and audit share one transaction.
    const { data: site, error: siteError } = await adminClient.rpc('create_site_atomic', {
      p_org_id: organisationId,
      p_actor_id: authResult.user.id,
      p_site: {
        name: name.trim(), state: state.trim(), discom: discom.trim(),
        voltage_category: effectiveVoltage, contract_demand_value: effectiveDemand,
        contract_demand_unit: effectiveUnit, metering_point: effectiveMetering,
        load_class: effectiveLoadClass,
      },
    });
    if (siteError || !site) {
      return NextResponse.json({ error: 'DATABASE_ERROR', message: siteError?.message || 'Site creation failed.' }, { status: 500 });
    }

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
