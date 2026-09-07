/**
 * Billing Provider Abstraction & Razorpay Adapter
 * Strictly distinguishes MOCK_DEVELOPMENT, RAZORPAY_TEST, and RAZORPAY_LIVE modes.
 * Fails closed in production if mock credentials are used.
 * Never fabricates fake order IDs in TEST or LIVE mode.
 */

import CryptoJS from 'crypto-js';

export type BillingMode = 'MOCK_DEVELOPMENT' | 'RAZORPAY_TEST' | 'RAZORPAY_LIVE';

export interface CheckoutRequest {
  organisationId: string;
  productId: string;
  siteId?: string;
  stateScope?: string;
  amountPaise: number;
  customerEmail: string;
  customerName: string;
  gstin?: string;
}

export interface CheckoutSession {
  orderId: string;
  amountPaise: number;
  currency: string;
  keyId: string;
  customerEmail: string;
  billingMode: BillingMode;
}

export interface IBillingProvider {
  readonly mode: BillingMode;
  createCheckout(req: CheckoutRequest): Promise<CheckoutSession>;
  verifyWebhookSignature(body: string, signature: string, secret?: string): boolean;
  cancelSubscription(subscriptionId: string): Promise<{ success: boolean; mode: BillingMode; message?: string }>;
}

export class RazorpayBillingAdapter implements IBillingProvider {
  readonly mode: BillingMode;
  private keyId: string;
  private keySecret: string;
  private webhookSecret: string;

  constructor() {
    this.keyId = process.env.RAZORPAY_KEY_ID || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || '';
    this.keySecret = process.env.RAZORPAY_KEY_SECRET || '';
    this.webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || '';

    if (this.keyId.startsWith('rzp_live_')) {
      this.mode = 'RAZORPAY_LIVE';
    } else if (this.keyId.startsWith('rzp_test_') && this.keySecret && !this.keySecret.includes('mock')) {
      this.mode = 'RAZORPAY_TEST';
    } else {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'CRITICAL SECURITY ERROR: Production deployment cannot silently fall back to MOCK billing. Valid Razorpay live/test credentials are required.'
        );
      }
      this.mode = 'MOCK_DEVELOPMENT';
      this.keyId = this.keyId || 'rzp_test_mock_key';
      this.keySecret = this.keySecret || 'rzp_test_mock_secret';
      this.webhookSecret = this.webhookSecret || 'rzp_mock_webhook_secret';
    }
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
    if (this.mode === 'MOCK_DEVELOPMENT') {
      const mockOrderId = `order_mock_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      return {
        orderId: mockOrderId,
        amountPaise: req.amountPaise,
        currency: 'INR',
        keyId: this.keyId,
        customerEmail: req.customerEmail,
        billingMode: this.mode,
      };
    }

    // In actual TEST or LIVE mode, invoke the real Razorpay Orders API
    if (!this.keySecret || this.keySecret.includes('mock')) {
      throw new Error(
        `PRODUCTION_CONFIG_REQUIRED: Razorpay ${this.mode} mode requires a valid RAZORPAY_KEY_SECRET.`
      );
    }

    const authHeader = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${authHeader}`,
      },
      body: JSON.stringify({
        amount: req.amountPaise,
        currency: 'INR',
        receipt: `rcpt_${req.organisationId.substring(0, 8)}_${Date.now()}`,
        notes: {
          organisation_id: req.organisationId,
          product_id: req.productId,
          site_id: req.siteId || '',
        },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Razorpay API error (${res.status}): ${errBody}`);
    }

    const data = await res.json();
    return {
      orderId: data.id,
      amountPaise: data.amount,
      currency: data.currency,
      keyId: this.keyId,
      customerEmail: req.customerEmail,
      billingMode: this.mode,
    };
  }

  verifyWebhookSignature(body: string, signature: string, secret?: string): boolean {
    const activeSecret = secret || this.webhookSecret;
    if (!activeSecret) {
      return false;
    }
    if (this.mode === 'MOCK_DEVELOPMENT' && signature === 'dev_signature_bypass') {
      return true;
    }
    const expectedSignature = CryptoJS.HmacSHA256(body, activeSecret).toString(CryptoJS.enc.Hex);
    return expectedSignature === signature;
  }

  async cancelSubscription(subscriptionId: string): Promise<{ success: boolean; mode: BillingMode; message?: string }> {
    if (this.mode === 'MOCK_DEVELOPMENT') {
      return {
        success: true,
        mode: this.mode,
        message: 'Mock subscription cancelled at period end.',
      };
    }

    if (!this.keySecret || this.keySecret.includes('mock')) {
      throw new Error(
        `PRODUCTION_CONFIG_REQUIRED: Razorpay ${this.mode} mode requires configured credentials to cancel subscription.`
      );
    }

    const authHeader = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
    const res = await fetch(`https://api.razorpay.com/v1/subscriptions/${subscriptionId}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${authHeader}`,
      },
      body: JSON.stringify({
        cancel_at_cycle_end: 1,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Razorpay cancel error (${res.status}): ${errBody}`);
    }

    return {
      success: true,
      mode: this.mode,
      message: 'Razorpay subscription cancelled at cycle end.',
    };
  }
}

export const billingProvider = new RazorpayBillingAdapter();
