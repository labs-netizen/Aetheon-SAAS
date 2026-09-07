# MODULE: Authentication, RBAC & Onboarding

- **Status**: `VERIFIED_IMPLEMENTED` (Core Tenancy Layer).
- **Authoritative UI**: `src/app/auth/login/page.tsx`, `src/app/auth/register/page.tsx`, `src/app/auth/accept-invite/page.tsx`, `src/components/layout/AppShell.tsx` (first-site onboarding modal).
- **Authoritative API**: `src/app/api/organisations/create/route.ts`, `src/app/api/invitations/send/route.ts`, `src/app/api/invitations/accept/route.ts`, `src/app/api/sites/route.ts`.
- **Auth/Entitlement**: Managed via GoTrue Auth and `memberships` table.
- **Reads**: `organisations`, `user_profiles`, `memberships`, `sites`, `site_access`.
- **Writes**: `organisations`, `user_profiles`, `memberships`, `sites`, `site_access`, `site_activation_history`, `audit_logs`.
- **RPCs**: `has_site_access`, `is_org_member`, `has_org_role`, `is_platform_admin`.
- **External Service**: Supabase GoTrue Auth service (port `:15431`).
- **Quality Gate**: Role boundary triggers: `trg_enforce_membership_role_boundary` prevents assigning internal roles; `trg_protect_user_profile_escalation` blocks setting `is_platform_admin = true`.
- **Fail-Closed Conditions**: Self-registration creates unprivileged profile (`is_platform_admin = false`). Newly registered orgs transition to `ONBOARDING_REQUIRED` until the first site is configured. Expired `AETHEON_ANALYST` sessions are rejected.
- **Provenance**: Records user registrations, invitations, role modifications, and logins in `audit_logs`.
- **Reports**: User access and membership listings.
- **Alerts**: Dispatches `INVITATION_ACCEPTED` notification.
- **Demo Behavior**: Interactive Demo Role Switcher in header; active only when `NEXT_PUBLIC_DEMO_MODE=true` on demo org.
- **Live Behavior**: Strict session token validation; unauthenticated requests receive HTTP 401; unauthorized access receives HTTP 403.
- **Tests**: `tests/integration/supabase_rls.test.ts` (Test 1–7), `tests/integration/adversarial_api.test.ts` (Test 2, 4, 5, 11, 15, 17), `tests/e2e/registration_journey.spec.ts`.
- **External Requirements**: Production Supabase Auth AAL2 / MFA setup.
- **Known Limitations**: SSO / SAML integrations are enterprise add-ons.
