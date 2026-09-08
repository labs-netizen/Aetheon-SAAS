import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { billingProvider } from '@/features/billing/razorpayAdapter';
import { recordAuditEvent } from '@/lib/audit';

export async function POST(request: NextRequest) {
  try {
    const adminClient = createAdminClient();
    let user: any = null;

    // Check Bearer token first
    const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const jwt = authHeader.replace('Bearer ', '').trim();
      const { data: userData } = await adminClient.auth.getUser(jwt);
      user = userData?.user;
    }

    // Check cookies if no Bearer token
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
      const { data: authData } = await supabase.auth.getUser();
      user = authData?.user;
    }

    if (!user) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }

    // Role gate: Only ORGANISATION_ADMIN can cancel subscriptions
    const { data: membership, error: memError } = await adminClient
      .from('memberships')
      .select('organisation_id, role, is_active')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (memError || !membership || membership.role !== 'ORGANISATION_ADMIN') {
      return NextResponse.json(
        { error: 'INSUFFICIENT_ROLE', message: 'Forbidden: Only ORGANISATION_ADMIN can manage or cancel subscriptions' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { subscriptionId } = body;
    if (!subscriptionId) {
      return NextResponse.json({ error: 'subscriptionId is required' }, { status: 400 });
    }

    // Verify subscription belongs to this organisation
    const { data: sub, error: subError } = await adminClient
      .from('subscriptions')
      .select('*')
      .eq('id', subscriptionId)
      .eq('organisation_id', membership.organisation_id)
      .single();

    if (subError || !sub) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
    }

    // Call provider cancellation
    const cancelResult = await billingProvider.cancelSubscription(sub.billing_provider_ref || sub.id);

    // Update subscription in database: set cancel_at_period_end = true
    const { error: updateError } = await adminClient
      .from('subscriptions')
      .update({
        cancel_at_period_end: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sub.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // Record audit event
    const auditRes = await recordAuditEvent(adminClient, {
      organisation_id: membership.organisation_id,
      actor_id: user.id,
      actor_role: membership.role || 'ORGANISATION_ADMIN',
      action: 'SUBSCRIPTION_CANCELLED',
      entity_type: 'SUBSCRIPTION',
      entity_id: sub.id,
      details: {
        product_id: sub.product_id,
        cancel_at_period_end: true,
        provider_mode: cancelResult.mode,
      },
    });

    if (!auditRes.success) {
      console.error('Failed to record subscription cancellation audit:', auditRes.error);
      return NextResponse.json(
        { error: 'AUDIT_RECORDING_FAILED', message: 'Subscription cancelled but audit log failed.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Subscription set to cancel at end of current billing period.',
      mode: cancelResult.mode,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
