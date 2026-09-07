import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';
import { billingProvider } from '@/features/billing/razorpayAdapter';
import { PRODUCTS, type ProductId } from '@/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { organisationId, siteId, productId } = body;

    if (!organisationId || !productId) {
      return NextResponse.json(
        { error: 'organisationId and productId are required' },
        { status: 400 }
      );
    }

    // 1. Authorize: Only Organisation Admin can initiate checkout / subscribe
    const authResult = await authorizeApiRequest(req, {
      organisationId,
      requiredRoles: ['ORGANISATION_ADMIN'],
    });

    if (!authResult.authorized) {
      return authResult.response;
    }

    // 2. Validate product against canonical catalogue (reject unknown product IDs, never default to Grid)
    const productConfig = PRODUCTS[productId as ProductId];
    if (!productConfig) {
      return NextResponse.json(
        {
          error: 'INVALID_PRODUCT_ID',
          message: `Unknown product ID '${productId}'. Must be one of: ${Object.keys(PRODUCTS).join(', ')}`,
        },
        { status: 400 }
      );
    }

    const amountPaise = productConfig.basePricePaise;
    const adminClient = createAdminClient();

    // 3. If siteId supplied, prove site belongs to organisationId
    if (siteId) {
      const { data: siteRecord, error: siteErr } = await adminClient
        .from('sites')
        .select('id, organisation_id')
        .eq('id', siteId)
        .maybeSingle();

      if (siteErr || !siteRecord || siteRecord.organisation_id !== organisationId) {
        return NextResponse.json(
          {
            error: 'INVALID_SITE',
            message: `Site '${siteId}' does not exist or does not belong to organisation '${organisationId}'.`,
          },
          { status: 400 }
        );
      }
    }

    // 4. Delegate to billing provider
    let session: any;
    try {
      session = await billingProvider.createCheckout({
        organisationId,
        siteId,
        productId,
        amountPaise,
        customerEmail: authResult.user.email || 'billing@aetheon.in',
        customerName: 'Aetheon Customer',
      });
    } catch (providerErr) {
      return NextResponse.json(
        {
          error: 'CHECKOUT_PROVIDER_ERROR',
          message: 'Failed to create checkout order with payment provider',
          details: providerErr instanceof Error ? providerErr.message : String(providerErr),
        },
        { status: 502 }
      );
    }

    if (!session || !session.orderId) {
      return NextResponse.json(
        {
          error: 'CHECKOUT_PROVIDER_ERROR',
          message: 'Payment provider did not return a valid order session',
        },
        { status: 502 }
      );
    }

    // 5. Persist authoritative local provider reference mapping fail-closed
    const { error: insertErr } = await adminClient
      .from('billing_checkout_sessions')
      .insert({
        provider_reference: session.orderId,
        organisation_id: organisationId,
        site_id: siteId || null,
        product_id: productId,
        amount_paise: amountPaise,
        provider_mode: session.billingMode,
        status: 'CREATED',
      });

    if (insertErr) {
      console.error('Failed to persist checkout session:', insertErr);
      return NextResponse.json(
        {
          error: 'PERSISTENCE_FAILED',
          message: 'Failed to record billing checkout session in database',
          details: insertErr.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      orderId: session.orderId,
      amountPaise: session.amountPaise,
      currency: session.currency,
      keyId: session.keyId,
      billingMode: session.billingMode,
      notes: {
        org_id: organisationId,
        site_id: siteId || null,
        product_id: productId,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to initiate checkout', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
