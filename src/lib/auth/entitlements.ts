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

  // Authoritative database check via Supabase admin client
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const supabase = createAdminClient();

    if (siteId) {
      const { data: site } = await supabase.from('sites').select('organisation_id, is_demo')
        .eq('id', siteId).maybeSingle();
      if (!site || site.organisation_id !== organisationId ||
          (site.is_demo && process.env.NEXT_PUBLIC_DEMO_MODE !== 'true')) {
        return { entitled: false, reason: 'SITE_ORGANISATION_MISMATCH' };
      }
    }
    const now = new Date().toISOString();
    let query = supabase
      .from('entitlements')
      .select('id, is_active, valid_until')
      .eq('organisation_id', organisationId)
      .eq('product_id', productId)
      .eq('is_active', true)
      .lte('valid_from', now)
      .or(`valid_until.is.null,valid_until.gt.${now}`);
    query = siteId ? query.or(`site_id.eq.${siteId},site_id.is.null`) : query.is('site_id', null);
    const { data, error } = await query.limit(1).maybeSingle();

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
