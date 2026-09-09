import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature } from '@/lib/security/webhook';
import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-razorpay-signature');
    // Delivery headers are unsigned; deduplicate by the authenticated body.
    const eventId = crypto.createHash('sha256').update(rawBody).digest('hex');

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

    const effectiveEventId = eventId;

    const supabase = createAdminClient();
    const eventType: string = eventPayload.event || 'unknown';

    const paymentEntity = eventPayload?.payload?.payment?.entity || {};
    const providerRef = paymentEntity.order_id || null;

    // 3. Atomic Database RPC (service_role privileged): Idempotency lock + State Mutation
    const { data: rpcResult, error: rpcError } = await supabase.rpc('process_razorpay_webhook_atomic', {
      p_event_id: effectiveEventId,
      p_event_type: eventType,
      p_payload: eventPayload,
      p_org_id: null,
      p_site_id: null,
      p_product_id: null,
      p_provider_ref: providerRef,
      p_amount_paise: null,
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

    if (rpcResult?.status === 'QUARANTINED' || rpcResult?.quarantined === true) {
      return NextResponse.json(
        {
          error: 'UNMAPPED_BILLING_REFERENCE',
          received: true,
          status: 'quarantined',
          message: rpcResult.message || 'Webhook quarantined due to unknown provider reference.',
          rpcResult,
        },
        { status: 422 }
      );
    }


    return NextResponse.json({ received: true, status: 'processed', rpcResult }, { status: 200 });
  } catch (err) {
    console.error('Webhook processing error:', err);
    return NextResponse.json(
      { error: 'Internal error processing webhook', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
