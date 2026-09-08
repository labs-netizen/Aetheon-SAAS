import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(request: Request) {
  try {
    let user: any = null;

    // Check for Authorization header Bearer token first (for API and integration test clients)
    const authHeader = request.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const tokenClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } }
      );
      const { data: authData } = await tokenClient.auth.getUser(token);
      if (authData?.user) {
        user = authData.user;
      }
    }

    // Fallback to cookie-based session for browser clients
    if (!user) {
      try {
        const cookieStore = await cookies();
        const supabase = createServerClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          {
            cookies: {
              getAll() {
                return cookieStore.getAll();
              },
              setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
                try {
                  cookiesToSet.forEach(({ name, value, options }) =>
                    cookieStore.set(name, value, options)
                  );
                } catch {
                  // The `setAll` method was called from a Server Component.
                }
              },
            },
          }
        );
        const { data: authData } = await supabase.auth.getUser();
        if (authData?.user) {
          user = authData.user;
        }
      } catch {
        // No cookies available
      }
    }

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      name,
      legalEntityName,
      gstin,
      siteName,
      state,
      discom,
      contractDemandValue,
      contract_demand_value,
      contractDemandUnit,
      contract_demand_unit,
      voltageCategory,
      voltage_category,
      meteringPoint,
      metering_point,
      loadClass,
      load_class,
      isDemo,
      is_demo,
    } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Organisation name is required' }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // Check if user already has an active organisation
    const { data: existingMembership } = await adminClient
      .from('memberships')
      .select('id, organisation_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (existingMembership) {
      return NextResponse.json({ error: 'User already belongs to an active organisation' }, { status: 400 });
    }

    // Membership and organisation creation are executed atomically inside create_organisation_atomic RPC
    const isDemoFlag = Boolean(isDemo || is_demo);
    const actualSiteName = siteName?.trim() || `${name.trim()} Main Facility`;

    let siteParams: any = null;

    if (isDemoFlag) {
      // Demo fixtures may retain deterministic defaults
      siteParams = {
        name: actualSiteName,
        state: state?.trim() || 'Maharashtra',
        discom: discom?.trim() || 'MSEDCL',
        voltage_category: voltageCategory || voltage_category || '33kV',
        contract_demand_value: contractDemandValue ? Number(contractDemandValue) : (contract_demand_value ? Number(contract_demand_value) : 1000),
        contract_demand_unit: contractDemandUnit || contract_demand_unit || 'kVA',
        metering_point: meteringPoint || metering_point || 'Main Incomer Feeder',
        load_class: loadClass || load_class || 'Continuous Process Industrial',
        is_demo: true,
      };
    } else {
      // NON-DEMO: Do NOT invent or default required electrical configuration
      const effectiveDemand = contractDemandValue !== undefined
        ? Number(contractDemandValue)
        : (contract_demand_value !== undefined ? Number(contract_demand_value) : undefined);
      const effectiveUnit = contractDemandUnit || contract_demand_unit;
      const effectiveVoltage = voltageCategory || voltage_category;
      const effectiveMetering = meteringPoint || metering_point;
      const effectiveState = state?.trim();
      const effectiveDiscom = discom?.trim();

      const hasCompleteElectricalConfig = Boolean(
        effectiveDemand && effectiveDemand > 0 &&
        effectiveUnit &&
        effectiveVoltage &&
        effectiveMetering &&
        effectiveState &&
        effectiveDiscom
      );

      if (hasCompleteElectricalConfig) {
        siteParams = {
          name: actualSiteName,
          state: effectiveState,
          discom: effectiveDiscom,
          voltage_category: effectiveVoltage.trim(),
          contract_demand_value: effectiveDemand,
          contract_demand_unit: effectiveUnit.trim(),
          metering_point: effectiveMetering.trim(),
          load_class: loadClass || load_class || 'Continuous Process Industrial',
          is_demo: false,
        };
      }
    }

    const { data: atomicResult, error: atomicErr } = await adminClient.rpc('create_organisation_atomic', {
      p_user_id: user.id,
      p_user_email: user.email,
      p_org_name: name.trim(),
      p_legal_entity_name: legalEntityName?.trim() || name.trim(),
      p_gstin: gstin?.trim() || null,
      p_site_params: siteParams,
      p_force_audit_failure: Boolean(body.force_audit_failure || body.forceAuditFailure),
    });

    if (atomicErr) {
      if (atomicErr.message.includes('USER_ALREADY_HAS_ORGANISATION')) {
        return NextResponse.json({ error: 'User already belongs to an active organisation' }, { status: 400 });
      }
      if (atomicErr.message.includes('FORCED_AUDIT_FAILURE_ROLLBACK')) {
        return NextResponse.json(
          { error: 'AUDIT_RECORDING_FAILED', message: 'Organisation creation rolled back due to audit recording failure.' },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { error: 'Failed to create organisation: ' + atomicErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      organisationId: atomicResult.organisation.id,
      siteId: atomicResult.site?.id || null,
      organisation: atomicResult.organisation,
      site: atomicResult.site,
      configurationStatus: atomicResult.configurationStatus,
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
