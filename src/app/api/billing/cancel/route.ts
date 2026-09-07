import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';
import { billingProvider } from '@/features/billing/razorpayAdapter';

export async function POST(req: NextRequest) {
  try {
    const { subscriptionId } = await req.json();

    if (!subscriptionId) {
      return NextResponse.json(
        { error: 'subscriptionId is required' },
        { status: 400 }
      );
    }

    const adminClient = createAdminClient();

    // 1. Fetch Subscription
    const { data: sub, error: subErr } = await adminClient
      .from('subscriptions')
      .select('id, organisation_id, status, current_period_end, billing_provider_ref')
      .eq('id', subscriptionId)
      .single();

    if (subErr || !sub) {
      return NextResponse.json(
        { error: 'SUBSCRIPTION_NOT_FOUND', message: 'Subscription record not found.' },
        { status: 404 }
      );
    }

    // 2. Authorize: Only Organisation Admin has billing management permission (Section 21)
    const authResult = await authorizeApiRequest(req, {
      organisationId: sub.organisation_id,
      requiredRoles: ['ORGANISATION_ADMIN'],
    });

    if (!authResult.authorized) {
      return authResult.response;
    }

    // 3. Invoke Billing Provider Layer (Section 23)
    const cancelResult = await billingProvider.cancelSubscription(subscriptionId);

    // 4. Update Subscription in Database
    const { error: updateErr } = await adminClient
      .from('subscriptions')
      .update({
        status: 'CANCELLED',
        cancel_at_period_end: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', subscriptionId);

    if (updateErr) {
      console.error('Failed to update subscription cancellation status:', updateErr);
      return NextResponse.json(
        { error: 'DATABASE_ERROR', message: 'Failed to update subscription in database.' },
        { status: 500 }
      );
    }

    // 5. Audit Event
    await adminClient.from('audit_logs').insert({
      actor_id: authResult.user.id,
      actor_role: authResult.role,
      organisation_id: sub.organisation_id,
      event_type: 'SUBSCRIPTION_CANCELLED',
      event_payload: {
        subscriptionId,
        providerMode: cancelResult.mode,
        effectiveUntil: sub.current_period_end,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Subscription scheduled for cancellation at the end of the current billing cycle.',
      subscriptionId,
      billingMode: cancelResult.mode,
      effectiveUntil: sub.current_period_end,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to cancel subscription', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
