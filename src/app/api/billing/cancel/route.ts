import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { billingProvider } from '@/features/billing/razorpayAdapter';

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

    const { subscriptionId } = await request.json();
    if (!subscriptionId) return NextResponse.json({ error: 'subscriptionId is required' }, { status: 400 });
    const { data: sub } = await adminClient.from('subscriptions').select('*').eq('id', subscriptionId).maybeSingle();
    if (!sub) return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
    const { data: membership } = await adminClient.from('memberships')
      .select('organisation_id, role, expires_at').eq('user_id', user.id)
      .eq('organisation_id', sub.organisation_id).eq('is_active', true).maybeSingle();
    if (!membership || membership.role !== 'ORGANISATION_ADMIN' ||
        (membership.expires_at && new Date(membership.expires_at) <= new Date())) {
      return NextResponse.json({ error: 'INSUFFICIENT_ROLE' }, { status: 403 });
    }
    // Persist and audit intent before any external side effect. Retries reuse this record.
    const { data: intent, error: intentError } = await adminClient.rpc('prepare_subscription_cancellation', {
      p_subscription_id: sub.id, p_org_id: sub.organisation_id,
      p_actor_id: user.id, p_provider_mode: billingProvider.mode,
    });
    if (intentError || !intent) return NextResponse.json({ error: 'CANCELLATION_INTENT_FAILED' }, { status: 500 });
    if (intent.status === 'COMPLETED') return NextResponse.json({ success: true, mode: intent.provider_mode });
    let cancelResult;
    try {
      cancelResult = await billingProvider.cancelSubscription(intent.provider_reference);
      if (!cancelResult.success || cancelResult.mode !== intent.provider_mode) throw new Error('Provider did not confirm cancellation');
    } catch {
      return NextResponse.json({ success: false, status: 'PENDING', error: 'CANCELLATION_RECONCILIATION_REQUIRED',
        message: 'Cancellation is recorded but provider confirmation is pending. Retry this request to reconcile.' }, { status: 202 });
    }

    // Atomically update subscription and record audit log
    const { data: updatedSub, error: rpcError } = await adminClient.rpc('cancel_subscription_atomic', {
      p_subscription_id: sub.id,
      p_org_id: membership.organisation_id,
      p_actor_id: intent.actor_id,
      p_actor_role: membership.role || 'ORGANISATION_ADMIN',
      p_provider_mode: cancelResult.mode,
      p_product_id: null,
    });

    if (rpcError || !updatedSub) {
      console.error('Failed to atomically cancel subscription and record audit:', rpcError);
      return NextResponse.json(
        { success: false, status: 'PENDING', error: 'CANCELLATION_RECONCILIATION_REQUIRED', message: 'Provider accepted cancellation; local completion is pending. Retry to reconcile.' },
        { status: 202 }
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
