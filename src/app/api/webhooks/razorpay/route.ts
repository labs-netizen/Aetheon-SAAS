import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature, isWebhookReplay, recordProcessedWebhook } from '@/lib/security/webhook';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-razorpay-signature');
    const eventId = req.headers.get('x-razorpay-event-id');

    const configuredSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!configuredSecret && process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'CONFIGURATION_ERROR', message: 'RAZORPAY_WEBHOOK_SECRET is not configured for production.' },
        { status: 500 }
      );
    }
    const webhookSecret = configuredSecret || 'test_webhook_secret_aetheon';

    // 1. Signature Verification
    if (!signature || !verifyWebhookSignature(rawBody, signature, webhookSecret)) {
      return NextResponse.json(
        { error: 'Invalid webhook signature' },
        { status: 400 }
      );
    }

    let eventPayload: Record<string, any>;
    try {
      eventPayload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON payload' },
        { status: 400 }
      );
    }

    const effectiveEventId = eventId || eventPayload.id || eventPayload?.payload?.payment?.entity?.id;

    // 2. Replay Check
    if (effectiveEventId && isWebhookReplay(effectiveEventId, eventPayload.created_at)) {
      return NextResponse.json(
        { status: 'already_processed', reason: 'Replay or duplicated event' },
        { status: 200 }
      );
    }

    const supabase = createAdminClient();
    const eventType: string = eventPayload.event || 'unknown';

    const paymentEntity = eventPayload?.payload?.payment?.entity || {};
    const notes = paymentEntity.notes || {};
    const orgId = notes.org_id || notes.organisation_id;
    const siteId = notes.site_id || null;
    const productId = notes.product_id || 'GRID_INTELLIGENCE';
    const amountPaise = Number(paymentEntity.amount || 0);
    const providerRef = paymentEntity.order_id || paymentEntity.id || effectiveEventId;

    // 3. Atomic Database RPC: Idempotency lock + Subscription + Entitlement + Invoice
    if (effectiveEventId && orgId) {
      const { data: rpcResult, error: rpcError } = await supabase.rpc('process_razorpay_webhook_atomic', {
        p_event_id: effectiveEventId,
        p_event_type: eventType,
        p_payload: eventPayload,
        p_org_id: orgId,
        p_site_id: siteId,
        p_product_id: productId,
        p_provider_ref: providerRef,
        p_amount_paise: amountPaise,
      });

      if (rpcError) {
        console.error('Atomic webhook processing RPC error:', rpcError);
        return NextResponse.json(
          { error: 'DATABASE_TRANSACTION_FAILED', details: rpcError.message },
          { status: 500 }
        );
      }

      if (rpcResult?.status === 'already_processed') {
        return NextResponse.json(
          { status: 'already_processed', message: 'Event was already processed.' },
          { status: 200 }
        );
      }

      recordProcessedWebhook(effectiveEventId);
    } else if (eventType === 'subscription.cancelled') {
      const subEntity = eventPayload?.payload?.subscription?.entity || {};
      const subRef = subEntity.id;

      if (subRef) {
        await supabase
          .from('subscriptions')
          .update({ status: 'CANCELLED', cancel_at_period_end: true })
          .eq('billing_provider_ref', subRef);
      }
    } else if (eventType === 'payment.failed') {
      const failedNotes = paymentEntity.notes || {};
      const failedOrgId = failedNotes.org_id || failedNotes.organisation_id;

      if (failedOrgId) {
        await supabase
          .from('notification_logs')
          .insert({
            organisation_id: failedOrgId,
            recipient_email: paymentEntity.email || 'finance@aetheon.in',
            template_id: 'PAYMENT_FAILURE',
            subject: 'Billing Alert: Payment Failed',
            payload: {
              error_code: paymentEntity.error_code,
              error_description: paymentEntity.error_description,
            },
            delivery_status: 'SENT',
          });
      }
    }

    return NextResponse.json({ received: true, status: 'processed' }, { status: 200 });
  } catch (err) {
    console.error('Webhook processing error:', err);
    return NextResponse.json(
      { error: 'Internal error processing webhook', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
