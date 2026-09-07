import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordAuditEvent } from '@/lib/audit';

export async function POST(request: Request) {
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

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, legalEntityName, gstin, siteName, state, discom, contractDemandValue } = body;

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

    // Create organisation
    const { data: org, error: orgError } = await adminClient
      .from('organisations')
      .insert({
        name: name.trim(),
        legal_entity_name: legalEntityName?.trim() || name.trim(),
        gstin: gstin?.trim() || null,
        is_active: true,
      })
      .select()
      .single();

    if (orgError || !org) {
      return NextResponse.json({ error: 'Failed to create organisation: ' + (orgError?.message || 'Unknown error') }, { status: 500 });
    }

    // Create ORGANISATION_ADMIN membership
    const { data: membership, error: memError } = await adminClient
      .from('memberships')
      .insert({
        organisation_id: org.id,
        user_id: user.id,
        role: 'ORGANISATION_ADMIN',
        is_active: true,
      })
      .select()
      .single();

    if (memError || !membership) {
      return NextResponse.json({ error: 'Failed to assign organisation admin membership' }, { status: 500 });
    }

    // Create default site if siteName provided or fallback
    const actualSiteName = siteName?.trim() || `${org.name} Main Facility`;
    const { data: site, error: siteError } = await adminClient
      .from('sites')
      .insert({
        organisation_id: org.id,
        name: actualSiteName,
        state: state?.trim() || 'Maharashtra',
        discom: discom?.trim() || 'MSEDCL',
        voltage_category: '33kV',
        contract_demand_value: contractDemandValue ? Number(contractDemandValue) : 1000,
        contract_demand_unit: 'kVA',
        metering_point: 'Main Incomer Feeder',
        load_class: 'Continuous Process Industrial',
        timezone: 'Asia/Kolkata',
        activation_status: 'AWAITING_DATA',
        activation_reason: 'Newly registered facility awaiting initial AMR interval data upload',
        is_demo: false,
      })
      .select()
      .single();

    if (siteError || !site) {
      return NextResponse.json({ error: 'Failed to create primary site: ' + (siteError?.message || 'Unknown error') }, { status: 500 });
    }

    // Grant site_access
    await adminClient
      .from('site_access')
      .insert({
        site_id: site.id,
        user_id: user.id,
        granted_by: user.id,
      });

    // Create default entitlements for the new organisation (GRID_INTELLIGENCE and OPEN_ACCESS)
    await adminClient
      .from('entitlements')
      .insert([
        {
          organisation_id: org.id,
          product_id: 'GRID_INTELLIGENCE',
          site_id: site.id,
          is_active: true,
        },
        {
          organisation_id: org.id,
          product_id: 'OPEN_ACCESS_COMPLIANCE',
          site_id: site.id,
          is_active: true,
        },
      ]);

    // Record audit event
    await recordAuditEvent(adminClient, {
      organisation_id: org.id,
      actor_id: user.id,
      action: 'ORGANISATION_CREATED',
      entity_type: 'ORGANISATION',
      entity_id: org.id,
      details: {
        org_name: org.name,
        site_name: site.name,
        registered_by: user.email,
      },
    });

    return NextResponse.json({
      success: true,
      organisation: org,
      site,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
