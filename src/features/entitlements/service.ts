/**
 * Centralized Entitlement Engine
 * Evaluates whether a given user, organisation, and site have permission to access a specific product module.
 * Strictly decoupled from operational data readiness.
 */

import { PRODUCTS } from '@/lib/constants';
import type { PlatformRole } from '@/types';

export interface EntitlementContext {
  userId: string;
  userRole: PlatformRole;
  organisationId: string;
  siteId?: string;
  productId: keyof typeof PRODUCTS;
}

export interface EntitlementResult {
  hasAccess: boolean;
  reason: 'GRANTED' | 'NO_ACTIVE_SUBSCRIPTION' | 'SITE_NOT_ENTITLED' | 'ROLE_UNAUTHORIZED' | 'MODULE_RETIRED';
  productName: string;
  isDemoAllowed: boolean;
}

// In-memory / Mock entitlement database for standalone development mode
const MOCK_ACTIVE_ENTITLEMENTS = new Set<string>([
  'a0000000-0000-0000-0000-000000000001:GRID_INTELLIGENCE:b0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001:DSM_RISK:b0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001:BESS_ARBITRAGE:b0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001:RENEWABLE_PORTFOLIO:b0000000-0000-0000-0000-000000000001',
]);

export function getEntitlement(ctx: EntitlementContext): EntitlementResult {
  const product = PRODUCTS[ctx.productId];

  if (!product) {
    return {
      hasAccess: false,
      reason: 'MODULE_RETIRED',
      productName: 'Unknown Module',
      isDemoAllowed: false,
    };
  }

  // Operator cannot manage or configure commercial billing, but can view subscribed operations
  // Check if site has entitlement key
  const siteKey = `${ctx.organisationId}:${ctx.productId}:${ctx.siteId || '*'}`;
  const wildcardKey = `${ctx.organisationId}:${ctx.productId}:*`;

  const isEntitled = MOCK_ACTIVE_ENTITLEMENTS.has(siteKey) || MOCK_ACTIVE_ENTITLEMENTS.has(wildcardKey);

  // In demo mode or for the seeded demo organisation, allow access to seeded products
  if (isEntitled) {
    return {
      hasAccess: true,
      reason: 'GRANTED',
      productName: product.name,
      isDemoAllowed: true,
    };
  }

  return {
    hasAccess: false,
    reason: 'NO_ACTIVE_SUBSCRIPTION',
    productName: product.name,
    isDemoAllowed: false,
  };
}
