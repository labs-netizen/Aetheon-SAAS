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

  // 2. Replay & Memory Check
  if (effectiveEventId && isWebhookReplay(effectiveEventId, eventPayload.created_at)) {
    return NextResponse.json(
      { status: 'ignored', reason: 'Replay or duplicated event' },
      { status: 200 }
    );
  }

  const supabase = createAdminClient();

  // 3. Database Idempotency Check
  if (effectiveEventId) {
    const { data: existing } = await supabase
      .from('processed_webhook_events')
      .select('id')
      .eq('id', effectiveEventId)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { status: 'already_processed' },
        { status: 200 }
      );
    }
  }

  const eventType: string = eventPayload.event || 'unknown';

  try {
    // 4. Event Processing Dispatcher
    if (eventType === 'order.paid' || eventType === 'payment.captured') {
      const paymentEntity = eventPayload?.payload?.payment?.entity || {};
      const notes = paymentEntity.notes || {};
      const orgId = notes.org_id || notes.organisation_id;
      const siteId = notes.site_id;
      const productId = notes.product_id;
      const amountPaise = paymentEntity.amount || 0;

      if (orgId && productId) {
        // Record or update subscription
        const now = new Date();
        const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

        const { data: sub } = await supabase
          .from('subscriptions')
          .insert({
            organisation_id: orgId,
            status: 'ACTIVE',
            current_period_start: now.toISOString(),
            current_period_end: periodEnd.toISOString(),
            billing_provider: 'RAZORPAY',
            billing_provider_ref: paymentEntity.order_id || paymentEntity.id,
          })
          .select()
          .single();

        // Grant Entitlement
        await supabase
          .from('entitlements')
          .upsert({
            organisation_id: orgId,
            product_id: productId,
            site_id: siteId || null,
            is_active: true,
            valid_from: now.toISOString(),
            valid_until: periodEnd.toISOString(),
            granted_by: 'RAZORPAY_WEBHOOK',
          });

        // Insert Invoice
        await supabase
          .from('invoices')
          .insert({
            organisation_id: orgId,
            subscription_id: sub?.id || null,
            invoice_number: `INV-${Date.now().toString().slice(-6)}`,
            amount_paise: amountPaise,
            total_paise: amountPaise,
            status: 'PAID',
            paid_at: now.toISOString(),
          });

        // Insert Notification Log
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

    // 5. Mark as processed
    if (effectiveEventId) {
      await supabase
        .from('processed_webhook_events')
        .insert({
          id: effectiveEventId,
          provider: 'RAZORPAY',
          event_type: eventType,
          payload: eventPayload,
        });

      recordProcessedWebhook(effectiveEventId);
    }

    return NextResponse.json({ received: true, status: 'processed' }, { status: 200 });
  } catch (err) {
    console.error('Webhook processing error:', err);
    return NextResponse.json(
      { error: 'Internal error processing webhook' },
      { status: 500 }
    );
  }
}
