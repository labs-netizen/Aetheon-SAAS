# MODULE: Platform Operations & Regulatory Review

- **Status**: `VERIFIED_IMPLEMENTED` (Internal Management Console).
- **Authoritative UI**: `src/app/admin/page.tsx`
- **Authoritative API**: `src/app/api/admin/audit/route.ts`
- **Auth/Entitlement**: Strictly requires `is_platform_admin === true` (or internal role `AETHEON_ANALYST` / `AETHEON_REGULATORY_REVIEWER` within session validity).
- **Reads**: `audit_logs` (immutable hash-chained log), `regulatory_sources`, `organisations`, `sites`.
- **Writes**: `regulatory_sources` (approval workflow: `REVIEW_PENDING` $\to$ `APPROVED` $\to$ `PUBLISHED`), `audit_logs`.
- **RPCs**: `is_platform_admin`, `enforce_analyst_session_limit`.
- **External Service**: None (direct administrative queries).
- **Quality Gate**: Evidence-based Launch Readiness Checklist: inspects actual system metrics (migrations, tests, build) rather than self-reported claims.
- **Fail-Closed Conditions**: Customer `ORGANISATION_ADMIN` accounts attempting to access `/admin` or `/api/admin/audit` are rejected with HTTP 403 Forbidden.
- **Provenance**: Displays cryptographic current and previous SHA-256 hashes for all audit events.
- **Reports**: Statutory audit trail export.
- **Alerts**: Dispatches `AUDIT_CHAIN_INTEGRITY_ALERT` if any hash mismatch is detected.
- **Demo Behavior**: Normal customer demo roles are blocked from accessing the console.
- **Live Behavior**: Multi-tenant administrative oversight, regulatory order approval gate management, model registry status monitoring.
- **Tests**: `tests/integration/adversarial_api.test.ts` (Test 14, 15, 17), `tests/integration/audit_chaining.test.ts` (5 tests), `tests/e2e/demo_smoke.spec.ts` (Test 9).
- **External Requirements**: Administrator MFA enforcement.
- **Known Limitations**: Administrative actions cannot overwrite or delete historical audit entries (strictly append-only).
