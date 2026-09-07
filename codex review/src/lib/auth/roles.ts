/**
 * Canonical Platform Roles and Vocabulary Reconciler
 * Authoritative mapping compliant with docs/PRODUCT_SPECIFICATION.md
 */

import type { PlatformRole } from '@/types';

export const CANONICAL_ROLES = [
  'ORGANISATION_ADMIN',
  'ENERGY_MANAGER',
  'OPERATOR',
  'FINANCE_SUSTAINABILITY_VIEWER',
  'AETHEON_ANALYST',
  'AETHEON_REGULATORY_REVIEWER',
] as const;

export type CanonicalRole = typeof CANONICAL_ROLES[number];

/**
 * Explicit typed alias mapping for shorthand or legacy identifiers.
 * Ensures the platform maintains a single authoritative role system without
 * contradictory definitions across database, API, and UI layers.
 */
export const ROLE_ALIASES: Record<string, CanonicalRole> = {
  // Canonical identifiers
  ORGANISATION_ADMIN: 'ORGANISATION_ADMIN',
  ENERGY_MANAGER: 'ENERGY_MANAGER',
  OPERATOR: 'OPERATOR',
  FINANCE_SUSTAINABILITY_VIEWER: 'FINANCE_SUSTAINABILITY_VIEWER',
  AETHEON_ANALYST: 'AETHEON_ANALYST',
  AETHEON_REGULATORY_REVIEWER: 'AETHEON_REGULATORY_REVIEWER',

  // Shorthand database / API aliases
  org_admin: 'ORGANISATION_ADMIN',
  admin: 'ORGANISATION_ADMIN',
  energy_manager: 'ENERGY_MANAGER',
  operator: 'OPERATOR',
  plant_operator: 'OPERATOR',
  finance_viewer: 'FINANCE_SUSTAINABILITY_VIEWER',
  sustainability_viewer: 'FINANCE_SUSTAINABILITY_VIEWER',
  analyst: 'AETHEON_ANALYST',
  regulatory_reviewer: 'AETHEON_REGULATORY_REVIEWER',
};

/**
 * Reconciles an input role string to its canonical PlatformRole.
 * Throws on unknown or unmapped roles.
 */
export function reconcileRole(rawRole: string): CanonicalRole {
  const canonical = ROLE_ALIASES[rawRole];
  if (!canonical) {
    throw new Error(
      `Unknown or unauthorized role identifier: '${rawRole}'. Must be one of: ${CANONICAL_ROLES.join(', ')}`
    );
  }
  return canonical;
}

/**
 * Returns true if the role is an internal Aetheon role (AETHEON_ANALYST, AETHEON_REGULATORY_REVIEWER).
 * Note: An unrestricted 'super_admin' shortcut does not exist. All administrative privileges
 * must be explicitly mediated by the appropriate internal role with full audit provenance.
 */
export function isInternalAetheonRole(role: PlatformRole): boolean {
  return role === 'AETHEON_ANALYST' || role === 'AETHEON_REGULATORY_REVIEWER';
}

/**
 * Returns true if the role is a tenant customer role.
 */
export function isCustomerRole(role: PlatformRole): boolean {
  return (
    role === 'ORGANISATION_ADMIN' ||
    role === 'ENERGY_MANAGER' ||
    role === 'OPERATOR' ||
    role === 'FINANCE_SUSTAINABILITY_VIEWER'
  );
}

/**
 * Guards internal administrative features against customer access.
 */
export function assertInternalAccess(role: PlatformRole, resource = 'Administrative Operation'): void {
  if (!isInternalAetheonRole(role)) {
    throw new Error(
      `Access Denied: ${resource} requires an internal Aetheon role (AETHEON_ANALYST or AETHEON_REGULATORY_REVIEWER). Current role '${role}' is restricted.`
    );
  }
}
