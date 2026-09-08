import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordAuditEvent } from '@/lib/audit';

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

    // Record audit event
    const auditRes = await recordAuditEvent(adminClient, {
      organisation_id: org.id,
      site_id: site.id,
      actor_id: user.id,
      actor_role: 'ORGANISATION_ADMIN',
      action: 'ORGANISATION_CREATED',
      entity_type: 'ORGANISATION',
      entity_id: org.id,
      details: {
        org_name: org.name,
        site_name: site.name,
        registered_by: user.email,
      },
    });

    if (!auditRes.success) {
      console.error('Organisation creation audit recording failure:', auditRes.error);
      return NextResponse.json(
        { error: 'AUDIT_RECORDING_FAILED', message: 'Organisation created but audit recording failed.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      organisationId: org.id,
      siteId: site.id,
      organisation: org,
      site,
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
