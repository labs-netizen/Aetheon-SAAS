import { describe, it, expect } from 'vitest';
import { getEntitlement } from '@/features/entitlements/service';

describe('Centralized Entitlement Engine', () => {
  it('should grant access to subscribed products for demo organisation', () => {
    const res = getEntitlement({
      userId: 'user-01',
      userRole: 'ENERGY_MANAGER',
      organisationId: 'a0000000-0000-0000-0000-000000000001',
      siteId: 'b0000000-0000-0000-0000-000000000001',
      productId: 'GRID_INTELLIGENCE',
    });
    expect(res.hasAccess).toBe(true);
    expect(res.reason).toBe('GRANTED');
  });

  it('should deny access to unsubscribed organisation', () => {
    const res = getEntitlement({
      userId: 'user-99',
      userRole: 'ENERGY_MANAGER',
      organisationId: 'unknown-org-id',
      siteId: 'site-99',
      productId: 'GRID_INTELLIGENCE',
    });
    expect(res.hasAccess).toBe(false);
    expect(res.reason).toBe('NO_ACTIVE_SUBSCRIPTION');
  });

  it('should deny access to non-existent module', () => {
    const res = getEntitlement({
      userId: 'user-01',
      userRole: 'ORGANISATION_ADMIN',
      organisationId: 'a0000000-0000-0000-0000-000000000001',
      // @ts-expect-error testing invalid product ID
      productId: 'NON_EXISTENT_MODULE',
    });
    expect(res.hasAccess).toBe(false);
    expect(res.reason).toBe('MODULE_RETIRED');
  });
});
