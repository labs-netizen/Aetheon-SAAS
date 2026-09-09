import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: Request) {
  try {
    let user = null;
    const adminClient = createAdminClient();
    const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');

    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      const token = authHeader.slice(7).trim();
      const { data: tokenUser } = await adminClient.auth.getUser(token);
      if (tokenUser?.user) {
        user = tokenUser.user;
      }
    }

    if (!user) {
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
                // Ignore
              }
            },
          },
        }
      );

      const { data: { user: cookieUser } } = await supabase.auth.getUser();
      user = cookieUser;
    }

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check internal role and platform admin permissions
    const { data: profile } = await adminClient
      .from('user_profiles')
      .select('is_platform_admin')
      .eq('id', user.id)
      .maybeSingle();

    const isPlatformAdmin = Boolean(profile?.is_platform_admin);

    const { data: membership } = await adminClient
      .from('memberships')
      .select('role, is_active, expires_at')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle();

    const role = membership?.role;

    // Reject customer administrators explicitly
    if (role === 'ORGANISATION_ADMIN' && !isPlatformAdmin) {
      return NextResponse.json(
        { error: 'Forbidden: Customer Organisation Admins are not permitted platform administration access' },
        { status: 403 }
      );
    }

    // Regulatory Reviewers are restricted to regulatory queue and cannot view global audit/tenant health
    if (role === 'AETHEON_REGULATORY_REVIEWER' && !isPlatformAdmin) {
      return NextResponse.json(
        { error: 'Forbidden: Regulatory Reviewers do not have scope for tenant health or global audit trails; restricted to regulatory queue.' },
        { status: 403 }
      );
    }

    // Enforce analyst expiry
    if (role === 'AETHEON_ANALYST') {
      if (!membership?.expires_at || new Date(membership.expires_at) <= new Date()) {
        return NextResponse.json(
          { error: 'Forbidden: Analyst support session has expired or is invalid' },
          { status: 403 }
        );
      }
    }

    const isAuthorizedInternal =
      isPlatformAdmin ||
      (role === 'AETHEON_ANALYST' && Boolean(membership?.expires_at && new Date(membership.expires_at) > new Date()));

    if (!isAuthorizedInternal) {
      return NextResponse.json({ error: 'Forbidden: Internal access required' }, { status: 403 });
    }

    // Platform-wide audit and health are reserved for platform administrators.
    if (!isPlatformAdmin) {
      return NextResponse.json({ error: 'Forbidden: Platform administrator required' }, { status: 403 });
    }

    // Query real audit logs from PostgreSQL
    const { data: logs, error: logError } = await adminClient
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (logError) {
      return NextResponse.json({ error: logError.message }, { status: 500 });
    }

    // Query tenant health metrics
    const { count: orgCount } = await adminClient.from('organisations').select('*', { count: 'exact', head: true });
    const { count: siteCount } = await adminClient.from('sites').select('*', { count: 'exact', head: true });
    const { count: alertCount } = await adminClient.from('alerts').select('*', { count: 'exact', head: true });
    const { count: reportCount } = await adminClient.from('report_records').select('*', { count: 'exact', head: true });

    return NextResponse.json({
      auditEvents: logs || [],
      tenantHealth: {
        totalOrganisations: orgCount || 0,
        totalSites: siteCount || 0,
        activeAlerts: alertCount || 0,
        totalReports: reportCount || 0,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
