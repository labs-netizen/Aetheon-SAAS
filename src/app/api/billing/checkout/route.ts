import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';
import { billingProvider } from '@/features/billing/razorpayAdapter';

const PRODUCT_PRICES_PAISE: Record<string, number> = {
  GRID_INTELLIGENCE: 1990000,
  OA_COMPLIANCE: 1490000,
  DSM_RISK: 2990000,
  BESS_ARBITRAGE: 4990000,
  RENEWABLE_PORTFOLIO: 2490000,
};

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

    const amountPaise = PRODUCT_PRICES_PAISE[productId] || 1990000;

    // 2. Delegate to billing provider
    const session = await billingProvider.createCheckout({
      organisationId,
      siteId,
      productId,
      amountPaise,
      customerEmail: authResult.user.email || 'billing@aetheon.in',
      customerName: 'Aetheon Customer',
    });

    // 3. Persist authoritative local provider reference mapping
    const adminClient = createAdminClient();
    await adminClient
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
