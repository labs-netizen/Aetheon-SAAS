import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

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
        { error: 'Missing organisationId or productId' },
        { status: 400 }
      );
    }

    const amountPaise = PRODUCT_PRICES_PAISE[productId] || 1990000;
    const razorpayKeyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || 'rzp_test_mock_key';

    // Mock/offline or test mode order generation
    const orderId = `order_aeth_${Date.now().toString().slice(-8)}`;

    return NextResponse.json({
      success: true,
      orderId,
      amountPaise,
      currency: 'INR',
      keyId: razorpayKeyId,
      notes: {
        org_id: organisationId,
        site_id: siteId || null,
        product_id: productId,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to initiate checkout' },
      { status: 500 }
    );
  }
}
