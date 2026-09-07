import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { billingProvider } from '@/features/billing/razorpayAdapter';

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

    // Get user's membership and organisation
    const { data: membership, error: memError } = await supabase
      .from('memberships')
      .select('organisation_id, role, is_active')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (memError || !membership) {
      return NextResponse.json({ error: 'No active organisation membership found' }, { status: 403 });
    }

    const orgId = membership.organisation_id;

    // Fetch active subscriptions
    const { data: subscriptions, error: subError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('organisation_id', orgId)
      .order('created_at', { ascending: false });

    if (subError) {
      return NextResponse.json({ error: subError.message }, { status: 500 });
    }

    // Fetch entitlements
    const { data: entitlements, error: entError } = await supabase
      .from('entitlements')
      .select('*')
      .eq('organisation_id', orgId)
      .order('created_at', { ascending: false });

    if (entError) {
      return NextResponse.json({ error: entError.message }, { status: 500 });
    }

    // Fetch invoices if table exists
    const { data: invoices } = await supabase
      .from('invoices')
      .select('*')
      .eq('organisation_id', orgId)
      .order('created_at', { ascending: false });

    return NextResponse.json({
      billingMode: billingProvider.mode,
      subscriptions: subscriptions || [],
      entitlements: entitlements || [],
      invoices: invoices || [],
      userRole: membership.role,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
