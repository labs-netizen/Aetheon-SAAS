import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkServerEntitlement } from '@/lib/auth/entitlements';
import { PlatformRole } from '@/types';
import { createClient } from '@supabase/supabase-js';

export interface GuardOptions {
  siteId?: string;
  organisationId?: string;
  productId?: string;
  requiredRoles?: PlatformRole[];
}

export interface GuardSuccess {
  authorized: true;
  user: {
    id: string;
    email?: string;
    is_platform_admin?: boolean;
  };
  organisationId: string;
  siteId?: string;
  role: PlatformRole;
  isDemo: boolean;
}

export interface GuardFailure {
  authorized: false;
  response: NextResponse;
}

export type GuardResult = GuardSuccess | GuardFailure;

const DEMO_ORG_IDS = [
  'a0000000-0000-0000-0000-000000000001',
  'org-demo-001',
];

const DEMO_SITE_IDS = [
  'b0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000002',
  's0000000-0000-0000-0000-000000000001',
  's0000000-0000-0000-0000-000000000002',
  'site-demo-001',
  'site-demo-002',
  'site-demo-pune',
  'site-demo-nagpur',
];

/**
 * Authorizes an incoming API request against:
 * 1. Authentication (session cookie or Bearer token)
 * 2. Organisation membership
 * 3. Site-level access control (has_site_access)
 * 4. Product subscription/entitlement
 * 5. Role permissions
 *
 * In Demo Mode (NEXT_PUBLIC_DEMO_MODE === 'true'), demo requests to demo entities
 * are allowed with appropriate entitlement gating.
 */
export async function authorizeApiRequest(
  req: NextRequest,
  options: GuardOptions
): Promise<GuardResult> {
  const isDemoModeEnabled = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
  const adminClient = createAdminClient();

  // 1. Resolve Authenticated User
  let user: { id: string; email?: string; is_platform_admin?: boolean } | null = null;
  const authHeader = req.headers.get('authorization');

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://mock-aetheon.supabase.co';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'mock-anon-key-placeholder';
    const tokenClient = createClient(supabaseUrl, supabaseAnonKey);
    const { data: authData, error: authError } = await tokenClient.auth.getUser(token);
    if (!authError && authData?.user) {
      user = {
        id: authData.user.id,
        email: authData.user.email,
        is_platform_admin: Boolean(authData.user.user_metadata?.is_platform_admin),
      };
    }
  }

  if (!user) {
    try {
      const serverSupabase = createServerSupabaseClient();
      const { data: authData } = await serverSupabase.auth.getUser();
      if (authData?.user) {
        user = {
          id: authData.user.id,
          email: authData.user.email,
          is_platform_admin: Boolean(authData.user.user_metadata?.is_platform_admin),
        };
      }
    } catch {
      // Cookies not available or not in browser context
    }
  }

  // 2. Handle Unauthenticated Requests
  if (!user) {
    // If demo mode is active and the requested site/org is a demo site/org
    const isTargetingDemo =
      (options.siteId && DEMO_SITE_IDS.includes(options.siteId)) ||
      (options.organisationId && DEMO_ORG_IDS.includes(options.organisationId));

    if (isDemoModeEnabled && isTargetingDemo) {
      // Demo entitlement check
      if (options.productId === 'OA_COMPLIANCE') {
        return {
          authorized: false,
          response: NextResponse.json(
            {
              error: 'UNSUBSCRIBED',
              message: 'Open Access Compliance Sentinel subscription is not active for this demo tier.',
              productId: options.productId,
            },
            { status: 403 }
          ),
        };
      }

      return {
        authorized: true,
        user: {
          id: 'u0000000-0000-0000-0000-000000000001',
          email: 'rajesh.sharma@demo.aetheonlabs.in',
          is_platform_admin: false,
        },
        organisationId: options.organisationId || DEMO_ORG_IDS[0],
        siteId: options.siteId || DEMO_SITE_IDS[0],
        role: 'ORGANISATION_ADMIN',
        isDemo: true,
      };
    }

    // Fail closed
    return {
      authorized: false,
      response: NextResponse.json(
        {
          error: 'UNAUTHENTICATED',
          message: 'Authentication required. Provide a valid session or Bearer token.',
        },
        { status: 401 }
      ),
    };
  }

  // 3. Resolve Organisation and Site Scope
  let resolvedOrgId = options.organisationId;
  if (options.siteId) {
    const { data: siteData, error: siteError } = await adminClient
      .from('sites')
      .select('id, organisation_id, name, state, discom')
      .eq('id', options.siteId)
      .maybeSingle();

    if (siteError || !siteData) {
      return {
        authorized: false,
        response: NextResponse.json(
          { error: 'SITE_NOT_FOUND', message: `Site '${options.siteId}' not found.` },
          { status: 404 }
        ),
      };
    }

    resolvedOrgId = siteData.organisation_id;
  }

  if (!resolvedOrgId) {
    return {
      authorized: false,
      response: NextResponse.json(
        { error: 'BAD_REQUEST', message: 'Either siteId or organisationId is required.' },
        { status: 400 }
      ),
    };
  }

  // 4. Verify Organisation Membership
  const { data: membership, error: memError } = await adminClient
    .from('memberships')
    .select('role, is_active, expires_at')
    .eq('organisation_id', resolvedOrgId)
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle();

  if (memError || !membership) {
    return {
      authorized: false,
      response: NextResponse.json(
        {
          error: 'FORBIDDEN_ORGANISATION',
          message: 'User does not belong to the organisation owning this resource.',
        },
        { status: 403 }
      ),
    };
  }

  const userRole = membership.role as PlatformRole;

  // Enforce time-bounded least privilege for AETHEON_ANALYST
  if (userRole === 'AETHEON_ANALYST') {
    if (!membership.expires_at || new Date(membership.expires_at) <= new Date()) {
      return {
        authorized: false,
        response: NextResponse.json(
          {
            error: 'ANALYST_ACCESS_EXPIRED',
            message: 'Aetheon Analyst delegated access has expired or does not possess a valid future expiry timestamp.',
          },
          { status: 403 }
        ),
      };
    }
  }

  // 5. Verify Site-Level Access (has_site_access)
  if (options.siteId && userRole !== 'ORGANISATION_ADMIN') {
    const { data: siteAccess, error: accessError } = await adminClient
      .from('site_access')
      .select('id')
      .eq('site_id', options.siteId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (accessError || !siteAccess) {
      return {
        authorized: false,
        response: NextResponse.json(
          {
            error: 'FORBIDDEN_SITE_ACCESS',
            message: `User does not have site-level access permissions for site '${options.siteId}'.`,
          },
          { status: 403 }
        ),
      };
    }
  }

  // 6. Verify Required Roles
  if (options.requiredRoles && options.requiredRoles.length > 0) {
    if (!options.requiredRoles.includes(userRole)) {
      return {
        authorized: false,
        response: NextResponse.json(
          {
            error: 'INSUFFICIENT_ROLE',
            message: `Role '${userRole}' is not permitted for this operation. Required: ${options.requiredRoles.join(', ')}`,
          },
          { status: 403 }
        ),
      };
    }
  }

  // 7. Verify Entitlement / Subscription
  if (options.productId) {
    const entitlement = await checkServerEntitlement(
      resolvedOrgId,
      options.siteId || '',
      options.productId
    );

    if (!entitlement.entitled) {
      return {
        authorized: false,
        response: NextResponse.json(
          {
            error: 'UNSUBSCRIBED',
            message: entitlement.reason || 'Organisation does not hold an active entitlement for this product.',
            productId: options.productId,
          },
          { status: 403 }
        ),
      };
    }
  }

  return {
    authorized: true,
    user,
    organisationId: resolvedOrgId,
    siteId: options.siteId,
    role: userRole,
    isDemo: false,
  };
}
