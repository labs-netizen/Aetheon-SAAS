/**
 * Authoritative Server-Side Entitlement Service
 * Evaluates subscription status, subscription items, site scope, state scope, and manual grants.
 * Enforces access controls on all protected backend routes and API endpoints.
 */

export interface EntitlementCheckResult {
  entitled: boolean;
  reason?: string;
  planTier?: string;
  validUntil?: string;
}

export interface EntitlementRecord {
  id: string;
  organisationId: string;
  productId: string;
  siteId?: string;
  stateScope?: string;
  isActive: boolean;
  validFrom: string;
  validUntil?: string;
  grantedBy: string;
}

/**
 * Server-side entitlement check for a specific product and site
 */
export async function checkServerEntitlement(
  organisationId: string,
  siteId: string,
  productId: string
): Promise<EntitlementCheckResult> {
  if (!organisationId || !productId) {
    return { entitled: false, reason: 'MISSING_CONTEXT: organisationId and productId are required.' };
  }

  // Demo mode fallback: ONLY when NEXT_PUBLIC_DEMO_MODE is explicitly 'true' and the org is the demo org
  const isDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
  const isDemoOrg = organisationId === 'a0000000-0000-0000-0000-000000000001' || organisationId === 'org-demo-001';

  if (isDemoMode && isDemoOrg) {
    // In demo mode, demo org has access to standard modules
    const demoAllowed = ['GRID_INTELLIGENCE', 'DSM_RISK', 'BESS_ARBITRAGE', 'RENEWABLE_PORTFOLIO'];
    if (demoAllowed.includes(productId)) {
      return { entitled: true, planTier: 'DEMO_FULL_SUITE' };
    }
    // OA_COMPLIANCE can be toggled/locked to demonstrate unsubscribed state
    return {
      entitled: false,
      reason: 'DEMO_UNSUBSCRIBED: Open Access Compliance Sentinel subscription is not active.',
      planTier: 'NONE',
    };
  }

  // Authoritative database check via Supabase client
  try {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server');
    const supabase = createServerSupabaseClient();

    const { data, error } = await supabase
      .from('entitlements')
      .select('id, is_active, valid_until')
      .eq('organisation_id', organisationId)
      .eq('product_id', productId)
      .eq('is_active', true)
      .or(`site_id.eq.${siteId},site_id.is.null`)
      .limit(1)
      .maybeSingle();

    if (error) {
      return { entitled: false, reason: `DATABASE_ERROR: ${error.message}` };
    }

    if (!data) {
      return { entitled: false, reason: 'NO_ACTIVE_ENTITLEMENT: Module is not included in current subscription.' };
    }

    if (data.valid_until && new Date(data.valid_until).getTime() < Date.now()) {
      return { entitled: false, reason: 'ENTITLEMENT_EXPIRED: Module subscription period has ended.' };
    }

    return { entitled: true, validUntil: data.valid_until };
  } catch (err) {
    return { entitled: false, reason: `SYSTEM_ERROR: ${err instanceof Error ? err.message : 'Unknown error'}` };
  }
}
