import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature, isWebhookReplay, recordProcessedWebhook } from '@/lib/security/webhook';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-razorpay-signature');
    const eventId = req.headers.get('x-razorpay-event-id');

    // Fail closed: Webhook secret must be explicitly configured in runtime
    const configuredSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!configuredSecret) {
      return NextResponse.json(
        {
          error: 'CONFIGURATION_ERROR',
          message: 'RAZORPAY_WEBHOOK_SECRET is not configured. Webhook processing fails closed.',
        },
        { status: 500 }
      );
    }
    const webhookSecret = configuredSecret;

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

    if (!effectiveEventId) {
      return NextResponse.json(
        { error: 'INVALID_EVENT', message: 'No resolvable event ID present in webhook payload' },
        { status: 400 }
      );
    }

    // 2. Replay Check
    if (isWebhookReplay(effectiveEventId, eventPayload.created_at)) {
      return NextResponse.json(
        { status: 'already_processed', reason: 'Replay or duplicated event' },
        { status: 200 }
      );
    }

    const supabase = createAdminClient();
    const eventType: string = eventPayload.event || 'unknown';

    const paymentEntity = eventPayload?.payload?.payment?.entity || {};
    const subscriptionEntity = eventPayload?.payload?.subscription?.entity || {};
    const notes = paymentEntity.notes || subscriptionEntity.notes || {};
    const orgId = notes.org_id || notes.organisation_id || null;
    const siteId = notes.site_id || null;
    const rawProductId = notes.product_id || 'GRID_INTELLIGENCE';
    const productId =
      rawProductId === 'OPEN_ACCESS_COMPLIANCE' ? 'OA_COMPLIANCE' :
      rawProductId === 'DSM_MONITOR' ? 'DSM_RISK' :
      rawProductId;
    const amountPaise = Number(paymentEntity.amount || subscriptionEntity.amount || 0);
    const providerRef = subscriptionEntity.id || paymentEntity.order_id || paymentEntity.id || effectiveEventId;

    // 3. Atomic Database RPC (service_role privileged): Idempotency lock + State Mutation
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
      // Return 500 so Razorpay retries if transaction failed
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

    return NextResponse.json({ received: true, status: 'processed', rpcResult }, { status: 200 });
  } catch (err) {
    console.error('Webhook processing error:', err);
    return NextResponse.json(
      { error: 'Internal error processing webhook', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
