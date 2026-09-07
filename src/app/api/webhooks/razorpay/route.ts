import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature, isWebhookReplay, recordProcessedWebhook } from '@/lib/security/webhook';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-razorpay-signature');
  const eventId = req.headers.get('x-razorpay-event-id');

  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret_aetheon';

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

  // 2. Replay & In-Memory Check
  if (effectiveEventId && isWebhookReplay(effectiveEventId, eventPayload.created_at)) {
    return NextResponse.json(
      { status: 'already_processed', reason: 'Replay or duplicated event' },
      { status: 200 }
    );
  }

  const supabase = createAdminClient();
  const eventType: string = eventPayload.event || 'unknown';

  // 3. Atomic Database Idempotency Lock
  // Insert marker into processed_webhook_events FIRST before applying any mutations.
  // If concurrent workers receive the same event, Postgres UNIQUE constraint guarantees exactly one proceeds.
  if (effectiveEventId) {
    const { error: lockError } = await supabase
      .from('processed_webhook_events')
      .insert({
        id: effectiveEventId,
        provider: 'RAZORPAY',
        event_type: eventType,
        payload: eventPayload,
      });

    if (lockError) {
      if (
        lockError.code === '23505' ||
        lockError.message.includes('duplicate key') ||
        lockError.message.includes('unique constraint')
      ) {
        return NextResponse.json(
          { status: 'already_processed', message: 'Event was already processed by a concurrent request.' },
          { status: 200 }
        );
      }
      return NextResponse.json(
        { error: 'Failed to record webhook idempotency marker', details: lockError.message },
        { status: 500 }
      );
    }

    recordProcessedWebhook(effectiveEventId);
  }

  try {
    // 4. Event Processing Dispatcher
    if (eventType === 'order.paid' || eventType === 'payment.captured') {
      const paymentEntity = eventPayload?.payload?.payment?.entity || {};
      const notes = paymentEntity.notes || {};
      const orgId = notes.org_id || notes.organisation_id;
      const siteId = notes.site_id;
      const productId = notes.product_id;
      const amountPaise = paymentEntity.amount || 0;
      const providerRef = paymentEntity.order_id || paymentEntity.id;

      if (orgId && productId) {
        const now = new Date();
        const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

        // Check if subscription with this provider reference already exists
        let subId: string | null = null;
        if (providerRef) {
          const { data: existingSub } = await supabase
            .from('subscriptions')
            .select('id')
            .eq('billing_provider_ref', providerRef)
            .maybeSingle();

          if (existingSub) {
            subId = existingSub.id;
          }
        }

        if (!subId) {
          const { data: sub } = await supabase
            .from('subscriptions')
            .insert({
              organisation_id: orgId,
              status: 'ACTIVE',
              current_period_start: now.toISOString(),
              current_period_end: periodEnd.toISOString(),
              billing_provider: 'RAZORPAY',
              billing_provider_ref: providerRef,
            })
            .select()
            .single();

          subId = sub?.id || null;
        }

        // Grant or refresh Entitlement
        await supabase
          .from('entitlements')
          .upsert(
            {
              organisation_id: orgId,
              product_id: productId,
              site_id: siteId || null,
              is_active: true,
              valid_from: now.toISOString(),
              valid_until: periodEnd.toISOString(),
              granted_by: 'RAZORPAY_WEBHOOK',
            },
            { onConflict: 'organisation_id,product_id,site_id' }
          );

        // Insert Invoice if not already recorded
        const invoiceNum = `INV-${providerRef ? providerRef.slice(-6) : Date.now().toString().slice(-6)}`;
        const { data: existingInv } = await supabase
          .from('invoices')
          .select('id')
          .eq('invoice_number', invoiceNum)
          .maybeSingle();

        if (!existingInv) {
          await supabase
            .from('invoices')
            .insert({
              organisation_id: orgId,
              subscription_id: subId,
              invoice_number: invoiceNum,
              amount_paise: amountPaise,
              total_paise: amountPaise,
              status: 'PAID',
              paid_at: now.toISOString(),
            });
        }

        // Notification Log
        await supabase
          .from('notification_logs')
          .insert({
            organisation_id: orgId,
            recipient_email: paymentEntity.email || 'finance@aetheon.in',
            template_id: 'PAYMENT_CONFIRMED',
            subject: `Payment Confirmed: ${productId}`,
            payload: {
              product_name: productId,
              amount: (amountPaise / 100).toFixed(2),
            },
            delivery_status: 'SENT',
          });
      }
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
      const paymentEntity = eventPayload?.payload?.payment?.entity || {};
      const notes = paymentEntity.notes || {};
      const orgId = notes.org_id || notes.organisation_id;

      if (orgId) {
        await supabase
          .from('notification_logs')
          .insert({
            organisation_id: orgId,
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
