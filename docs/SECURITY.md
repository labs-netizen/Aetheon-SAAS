# Aetheon Energy Intelligence Platform - Security & Governance Architecture (SECURITY.md)

## 1. Security Overview

The **Aetheon Energy Intelligence Platform** processes sensitive C&I operational data, interval meter telemetry, procurement pricing, and plant configurations. This document outlines the security architecture, controls implemented, known limitations, and procedures awaiting specialist audit.

> [!CAUTION]
> This platform has not yet undergone an independent third-party penetration test. All security controls documented herein represent first-pass production-oriented engineering and must undergo the specialist audit outlined in `docs/HANDOFF_TO_ASTRA.md` prior to commercial paid launch.

---

## 2. Automated Security & Isolation Test Suite

A comprehensive automated verification suite has been implemented across Vitest, live PostgreSQL RLS, Pytest solvers, and Playwright E2E suites (288/288 passing). The final database catalog inspection also passed with zero violations across the audited RLS, definer search-path, execution-ACL, and table-grant invariants.

### 2.1 Live PostgreSQL Engine RLS Verification (`tests/integration/supabase_rls.test.ts` - 14/14 Passing)
1. **Multi-Tenant Isolation**: An authenticated client representing User B in Organisation B querying `sites` or `organisations` receives zero records belonging to Organisation A.
2. **Cross-Tenant Mutation Blocking**: User B attempting to insert or update telemetry under Organisation A's ID is rejected by PostgreSQL RLS policy `sites_isolation_insert` with an engine-level error.
3. **Profile Boundary Isolation**: User B can only view profiles within their own organization or their own user record, preventing corporate espionage across tenants.
4. **GoTrue Auth Trigger Bootstrap**: `handle_new_user()` trigger automatically provisions `user_profiles` with `SECURITY DEFINER SET search_path = public` without granting administrative privileges.
5. **Public Reference Tables**: Reference tables (`products`, `discom_tariffs`) remain queryable by all authenticated users without leaking tenant data.
6. **Privilege-Escalation Attack Rejection**: Trigger `trg_protect_user_profile_escalation` blocks any user-driven update that attempts to set `is_platform_admin = true`.
7. **Role Boundary Enforcement**: Trigger `trg_enforce_membership_role_boundary` prevents customer `ORGANISATION_ADMIN`s from assigning internal Aetheon roles (`AETHEON_ANALYST`, `AETHEON_REGULATORY_REVIEWER`).
8. **Site-Level Access Isolation**: Function `has_site_access()` verifies that a user assigned to Site 1 receives zero rows when querying Site 2 telemetry, even if both sites belong to the same organisation.
9. **Regulatory Visibility Gate**: Unapproved regulatory rules (`REVIEW_PENDING`, `CHANGE_DETECTED`, `EXTRACTED`, `CAPTURED`) are strictly hidden from customer sessions; only `APPROVED` and `PUBLISHED` rules are visible.
10. **Server-Only Operational Outputs**: Client attempts to directly INSERT rows into trusted operational tables (`grid_forecast_runs`, `grid_forecast_blocks`, `bess_signal_runs`, `dsm_evaluation_runs`) are rejected by RLS; writes are restricted exclusively to `service_role`.
11. **Server-Generated Data Protection**: Customer accounts cannot forge or directly insert forecast runs.

### 2.2 Live Tamper-Evident Audit Chaining (`tests/integration/audit_chaining.test.ts` - 5/5 Passing)
1. **Deterministic Genesis Hash**: Event A receives a 64-character SHA-256 genesis hash computed deterministically.
2. **Cryptographic Chaining**: Event B's `previous_hash` strictly matches Event A's `current_hash`.
3. **UPDATE Immutability**: Database trigger rejects any UPDATE operation on `audit_logs`.
4. **DELETE Immutability**: Database trigger rejects any DELETE operation on `audit_logs`.
5. **Concurrency Safety**: Enforces `pg_advisory_xact_lock(hashtext('audit_logs_hash_chain'))` to guarantee zero chain forks under concurrent inserts.

### 2.3 Authority & Auditability Suite (`tests/integration/authority_and_auditability.test.ts` - 16/16 Passing)
1. **Customer Activation Bypass Blocked**: Org Admins and Energy Managers receive HTTP 400 when attempting to set `activation_status`, `activation_reason`, or `last_status_change`. Normal site electrical parameters update successfully.
2. **Atomic Ingestion Activation History**: `commit_ingestion_transaction` transitions site state and atomically records a row in `site_activation_history` without duplicate history on unchanged status.
3. **Canonical Audit Write Contract**: `recordAuditEvent()` emits only real schema columns (`action`, `entity_type`, `entity_id`, `details`, etc.); legacy fake columns dropped; hash chain trigger operates cleanly.
4. **Zero Free Paid Entitlements**: New non-demo organisations start with zero active paid entitlements. Calling paid modules returns 403. Paid webhook capture activates only purchased product.
5. **Grid Server Authority**: Quality gate evaluation matches requested `operatingDate` exactly; wrong-date quality cannot authorize forecast; authoritative tariff requires voltage match and approved regulatory source; live solver provenance emitted.
6. **BESS Live Safety Authority**: Browser `initialSocPct` ignored; DB SOC bounded by `min_soc_pct <= current_soc_pct <= max_soc_pct`; violation triggers `SAFETY_INTERLOCK`.

### 2.4 Adversarial API Test Suite (`tests/integration/adversarial_api.test.ts` - 34/34 Passing)
1. **Unauthenticated Request Rejection**: Unauthenticated requests to `/api/forecast` return 401 Unauthorized.
2. **Cross-Tenant Site Isolation**: Attempting to query an operational endpoint for a site belonging to a foreign organisation returns 403 Forbidden.
3. **Site Boundary Isolation**: A user without an active `site_access` grant for a specific site is rejected with 403 Forbidden.
4. **Subscription Entitlement Enforcement**: Requesting module endpoints without an active subscription entitlement returns 403 Forbidden.
5. **Operator Role Rejection**: OPERATOR accounts attempting to modify site parameters return 403 Forbidden.
6. **Internal Role Escalation**: Org Admin attempting to invite internal roles returns 403 Forbidden.
7. **BESS Arbitrage Safety**: BESS optimisation API suppresses recommendations when battery SOC is out of bounds or negative (`SAFETY_INTERLOCK`).
8. **Duplicate Ingestion Rejection**: Ingestion commit endpoint computes SHA-256 on actual file content and rejects duplicates with 409 Conflict.
9. **Exact 96-Row Ingestion Enforcement**: Rejects non-96-row payloads with 400 Bad Request.
10. **Webhook Replay Deduplication**: Replayed Razorpay webhook events are transactionally deduplicated via atomic pre-insertion.
11. **Invitation Email Binding**: User B attempting to accept an invitation token issued to User A's email is rejected with 403 Forbidden.
12. **Analyst Expiry Enforcement**: Expired AETHEON_ANALYST memberships return 403 Forbidden across server endpoints.
13. **Indefinite Analyst Creation Rejection**: Creating an analyst role without an `expires_at` or with `expires_at` > 24 hours is rejected at write-time.
14. **Compliance Approval Gate**: `/api/compliance` strictly filters out REVIEW_PENDING or unapproved rules; returns only APPROVED/PUBLISHED entries.
15. **Unmapped Webhook Quarantine**: Razorpay webhooks referencing unknown checkout sessions are quarantined and rejected without granting entitlements.
16. **Canonical Report Generation Contract**: Report generation enforces canonical `report_records` schema, stores provenance, and uploads to private storage.
17. **Canonical Report Download Route**: `/api/reports/[id]/download` enforces site access and returns structured `REPORT_FILE_UNAVAILABLE` on missing files without data fabrication.
18. **Billing First-Payment Atomicity**: Handles brand-new subscription flow, inserting into `billing_provider_ref` and provisioning entitlements.
19. **Durable Webhook Quarantine**: Unmapped webhook provider reference inserts into `processed_webhook_events` with status `'QUARANTINED'` and returns 422 without rolling back quarantine.
20. **Fail-Closed Grid Report Generation**: Generation aborts if forecast run is missing, quality is not publishable, freshness is stale, or validation failed.
21. **Exact V1 CSV Contract Enforcement**: Rejects impossible calendar dates (e.g. 2026-02-31), multiple dates, or duplicate blocks.
22. **BESS Performance Report Proof**: Verifies BESS performance report generation from optimization runs.
23. **DSM Evaluation Run Proof**: Verifies zero-incident evaluation run stamp in `dsm_evaluation_runs` and distinguishes from data gaps in reports.
24–34. **Extended Security Isolation Scenarios**: Quality gate server authority, voltage category mismatches, unentitled downloads, and role boundary validations.

---

## 3. Implemented Protections

### 3.1 Multi-Tenant & Site-Level Isolation
- **Row Level Security (RLS)**: Enforced directly at the PostgreSQL layer in the final 21-migration schema. All tenant tables (`sites`, `interval_data_96`, `subscriptions`, `alerts`, `audit_logs`, `compliance_obligations`, `report_records`) contain an `organisation_id` foreign key.
- **Site-Level Access Helper**: `has_site_access(p_user_id, p_site_id)` checks both explicit entries in `site_access` and organisation administration privileges, completely closing site-bleed vulnerabilities.
- **Session Scoping**: Authenticated queries resolve tenant membership via the `memberships` table. Direct cross-tenant querying is prevented at the database kernel level.
- **Private Storage**: Supabase Storage buckets for CSV uploads and report files are configured as private with signed URLs for authorized users only.

### 3.2 Role-Based Access Control (RBAC) & Analyst Expiry
- 6 distinct canonical roles enforced across UI routing, API guard, and database triggers:
  - `ORGANISATION_ADMIN`: Organization, billing, user, and site administration. Cannot assign internal Aetheon roles.
  - `ENERGY_MANAGER`: Operational dashboards, data upload, asset configuration. Zero billing management.
  - `OPERATOR`: Alerts view and incident acknowledgment. Zero billing management and zero user management.
  - `FINANCE_SUSTAINABILITY_VIEWER`: Read-only financial and sustainability reports. Zero operational ingestion.
  - `AETHEON_ANALYST`: Internal support role with mandatory write-time and runtime time-expiry (`expires_at`, max 24 hours) and mandatory audit logging.
  - `AETHEON_REGULATORY_REVIEWER`: Internal regulatory publishing role. Completely isolated from customer billing permissions.
- **Client Role Switcher Isolation**: Gated behind `NEXT_PUBLIC_DEMO_MODE === 'true'`. In production mode, role switching in client UI is disabled and role identity is strictly derived from verified Supabase session claims.

### 3.3 Secret Management & Frontend Boundary
- Frontend code utilizes only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Supabase `SERVICE_ROLE_KEY`, Razorpay webhook secrets, and analytics service tokens are restricted strictly to server-side Next.js route handlers.
- Safe CSV parsing: Spreadsheet parsing vulnerabilities eliminated by strictly supporting standard CSV formats with server-side SHA-256 calculation and contiguity validation.
- Client-controlled `parsedData` JSON bypass has been removed from live customer endpoints.

### 3.4 Idempotency & Webhook Verification
- Segregated billing provider modes: `MOCK_DEVELOPMENT`, `RAZORPAY_TEST`, and `RAZORPAY_LIVE`. Fails closed if mock mode is attempted in production.
- Razorpay webhooks require cryptographic HMAC-SHA256 signature verification before updating subscription state.
- Authoritative commercial bindings are persisted in `billing_checkout_sessions` before checkout; webhooks verify against local records rather than trusting notes.
- Webhook deduplication enforces atomic pre-insertion in `processed_webhook_events`.

---

## 4. Governance, Auditability & Incident Response

### 4.1 Audit Logging & Cryptographic Chaining
- Every tenant creation, user invitation, role modification, subscription state change, file ingestion, regulatory approval, and alert acknowledgment writes a row to `audit_logs`.
- PostgreSQL trigger `trg_chain_audit_log_hash` computes:
  `current_hash = encode(sha256((coalesce(previous_hash,'GENESIS') || coalesce(actor_id::text,'') || coalesce(action,'') || coalesce(entity_type,'') || coalesce(created_at::text,''))::bytea), 'hex')`
- PostgreSQL trigger `trg_protect_audit_logs` rejects any UPDATE or DELETE operations on audit records.
- Concurrency protected via `pg_advisory_xact_lock`.

### 4.2 Regulatory Publication Quality Gate
- Untrusted web-scraped or AI-extracted regulatory parameters are locked in `CAPTURED`, `EXTRACTED`, `CHANGE_DETECTED`, or `REVIEW_PENDING`.
- No user-facing calculation or customer query may retrieve rules until an `AETHEON_REGULATORY_REVIEWER` moves them to `APPROVED` or `PUBLISHED`.
- Synthetic demo parameters are explicitly stamped `DEMO / UNVERIFIED`.

### 4.3 Aetheon Admin Security Requirements
- Multi-Factor Authentication (MFA / AAL2) Status: `PRODUCTION_CONFIG_REQUIRED`. For local development and CI testing, GoTrue AAL1 is functional; production deployment mandates enabling Supabase Auth TOTP/MFA for all accounts with internal roles (`AETHEON_ANALYST`, `AETHEON_REGULATORY_REVIEWER`) or `is_platform_admin = true`.
- Analyst access sessions expire automatically after a maximum of 24 hours (`expires_at` enforced at database write-time, RLS layers, and API guard).

### 4.4 Operational Failure & Fail-Safe Persistence
- Operational API routes (`/api/forecast`, `/api/dsm`, `/api/bess`, `/api/renewables`) fail safely: if model run persistence fails, the route returns an error rather than publishing an unpersisted result.
- Telemetry failure triggers an automatic transition of site monitoring to `DEGRADED`.
- Live mode never synthesizes fake operational curves or synthetic fallback numbers when telemetry or tariffs are unavailable.

---
## 5. Alert System Status (Honest Disclosure)

**Current Implementation Status:**
- **Alert Persistence & Acknowledgement**: `VERIFIED_LOCAL` - Alerts are persisted to PostgreSQL with tamper-evident audit chaining. Acknowledgement is atomic (alert update + audit log in single transaction via `acknowledge_alert_atomic` RPC).
- **Automated Alert Generation**: `NOT_IMPLEMENTED / INTERNAL_VALIDATION` - No condition-evaluation engine exists. Alert definitions table exists but no scheduled worker evaluates conditions against live telemetry.
- **Email Delivery Provider**: `PRODUCTION_CONFIG_REQUIRED` - `notification_logs` and `notification_templates` tables exist, but no outbound email adapter (Mailpit/SMTP/Razorpay Email) is wired. Email delivery is not yet functional.

**Do Not Claim:**
- Templates ≠ delivery engine
- Alert definitions table ≠ condition evaluator
- `notification_logs` existence ≠ operational delivery pipeline

**Required for Production:**
1. Condition evaluator service (cron/worker) that reads telemetry → evaluates `alert_definitions` → inserts `alerts` → logs to `notification_logs`
2. Outbound email adapter with provider credentials (Mailpit for dev, production SMTP for live)
3. Deduplication/cooldown logic using `alerts.fingerprint` and `triggered_at`
4. Delivery retry with exponential backoff
