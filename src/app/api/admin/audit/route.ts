import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: Request) {
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
              // Ignore
            }
          },
        },
      }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user has internal role
    const adminClient = createAdminClient();
    const { data: membership } = await adminClient
      .from('memberships')
      .select('role, is_active, expires_at')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle();

    const role = membership?.role;
    const isInternal = role === 'AETHEON_ANALYST' || role === 'AETHEON_REGULATORY_REVIEWER' || role === 'ORGANISATION_ADMIN';

    if (!isInternal) {
      return NextResponse.json({ error: 'Forbidden: Internal access required' }, { status: 403 });
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
