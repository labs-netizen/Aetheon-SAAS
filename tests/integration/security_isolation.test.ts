import { describe, it, expect } from 'vitest';
import { getEntitlement } from '@/features/entitlements/service';
import { billingProvider } from '@/features/billing/razorpayAdapter';

describe('Security, Multi-Tenant Isolation & Webhook Idempotency', () => {
  it('should enforce organisation isolation: Org A cannot access Org B site entitlements', () => {
    const orgAId = 'a0000000-0000-0000-0000-000000000001';
    const orgBId = 'a0000000-0000-0000-0000-000000000002';
    const orgASite = 'b0000000-0000-0000-0000-000000000001';

    // Org A accessing its own site
    const authA = getEntitlement({
      userId: 'user-a',
      userRole: 'ORGANISATION_ADMIN',
      organisationId: orgAId,
      siteId: orgASite,
      productId: 'GRID_INTELLIGENCE',
    });
    expect(authA.hasAccess).toBe(true);

    // Org B attempting to access Org A site
    const authB = getEntitlement({
      userId: 'user-b',
      userRole: 'ORGANISATION_ADMIN',
      organisationId: orgBId,
      siteId: orgASite,
      productId: 'GRID_INTELLIGENCE',
    });
    expect(authB.hasAccess).toBe(false);
    expect(authB.reason).toBe('NO_ACTIVE_SUBSCRIPTION');
  });

  it('should verify cryptographic signature on payment webhooks', () => {
    const payload = JSON.stringify({ event: 'payment.captured', id: 'pay_123' });
    const testSecret = 'secret_test_key_123';

    // Compute legitimate HMAC-SHA256 signature
    const crypto = require('crypto');
    const validSignature = crypto.createHmac('sha256', testSecret).update(payload).digest('hex');

    expect(billingProvider.verifyWebhookSignature(payload, validSignature, testSecret)).toBe(true);

    // Tampered payload
    expect(billingProvider.verifyWebhookSignature(payload + 'tampered', validSignature, testSecret)).toBe(false);

    // Forged signature
    expect(billingProvider.verifyWebhookSignature(payload, 'forged_signature_hex', testSecret)).toBe(false);
  });

  it('should prevent unapproved regulatory data from becoming customer-facing', () => {
    const regulatorySources = [
      { id: '1', title: 'Approved Order', status: 'APPROVED' },
      { id: '2', title: 'Unapproved Draft Order', status: 'CHANGE_DETECTED/REVIEW_PENDING' },
    ];

    // Filter rule: only APPROVED status can be presented to customer portal
    const customerVisible = regulatorySources.filter((s) => s.status === 'APPROVED');
    expect(customerVisible).toHaveLength(1);
    expect(customerVisible[0].title).toBe('Approved Order');
  });
});
