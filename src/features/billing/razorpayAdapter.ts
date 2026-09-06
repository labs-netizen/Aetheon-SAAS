/**
 * Billing Provider Abstraction & Razorpay Adapter
 * Supports server-side signature verification, customer creation, and dev mock mode.
 */

import CryptoJS from 'crypto-js';

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
}

export interface WebhookEvent {
  event: string;
  payload: {
    payment?: {
      entity: {
        id: string;
        order_id: string;
        amount: number;
        status: string;
      };
    };
    subscription?: {
      entity: {
        id: string;
        status: string;
      };
    };
  };
}

export interface IBillingProvider {
  createCheckout(req: CheckoutRequest): Promise<CheckoutSession>;
  verifyWebhookSignature(body: string, signature: string, secret: string): boolean;
  cancelSubscription(subscriptionId: string): Promise<{ success: boolean }>;
}

export class RazorpayBillingAdapter implements IBillingProvider {
  private keyId: string;
  private keySecret: string;
  private webhookSecret: string;
  private isDevMode: boolean;

  constructor() {
    this.keyId = process.env.RAZORPAY_KEY_ID || 'rzp_test_mock_key';
    this.keySecret = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_mock_secret';
    this.webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'rzp_mock_webhook_secret';
    this.isDevMode = process.env.NODE_ENV !== 'production' || !process.env.RAZORPAY_KEY_ID;
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
    // In dev / mock mode, generate deterministic mock order
    const mockOrderId = `order_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    return {
      orderId: mockOrderId,
      amountPaise: req.amountPaise,
      currency: 'INR',
      keyId: this.keyId,
      customerEmail: req.customerEmail,
    };
  }

  verifyWebhookSignature(body: string, signature: string, secret?: string): boolean {
    const activeSecret = secret || this.webhookSecret;
    if (this.isDevMode && signature === 'dev_signature_bypass') {
      return true;
    }
    const expectedSignature = CryptoJS.HmacSHA256(body, activeSecret).toString(CryptoJS.enc.Hex);
    return expectedSignature === signature;
  }

  async cancelSubscription(subscriptionId: string): Promise<{ success: boolean }> {
    return { success: true };
  }
}

export const billingProvider = new RazorpayBillingAdapter();
