# API_MAP.md — Authoritative Next.js API Routes

This map documents the core Next.js API route handlers, authorization requirements, read/write patterns, and fail-closed conditions.

## 1. Route Registry

### `POST /api/ingestion/commit`
- **Auth / Role**: Authenticated (`ENERGY_MANAGER` or `ORGANISATION_ADMIN`).
- **Site Access**: Validated (`has_site_access(siteId)`).
- **Entitlement**: Verified (`GRID_INTELLIGENCE` or active base plan).
- **Major Reads**: Computes SHA-256 on multipart CSV stream; parses 96 blocks.
- **Major Writes**: Calls RPC `commit_ingestion_transaction` (inserts `ingestion_runs`, upserts `interval_data_96`, updates `sites.activation_status`, inserts `audit_logs`).
- **Service Calls**: None (pure PostgreSQL RPC).
- **Fail-Closed Conditions**: Returns 409 on duplicate SHA-256; returns 400 on non-contiguous or missing blocks (<96 rows).
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 8, 9), `tests/e2e/persistence_journey.spec.ts`.

### `POST /api/forecast`
- **Auth / Role**: Authenticated session.
- **Site Access**: Validated via `authorizeApiRequest(req, { siteId })`.
- **Entitlement**: `GRID_INTELLIGENCE`.
- **Major Reads**: `sites`, `interval_data_96` (96-block meter load), `discom_tariffs`.
- **Major Writes**: Service-role inserts into `grid_forecast_runs` and `grid_forecast_blocks` (canonical FK: `run_id`).
- **Service Calls**: Python FastAPI (`POST /forecast` on port 8000).
- **Fail-Closed Conditions**: If telemetry is stale or site is uncalibrated (`AWAITING_DATA`), returns `DATA GAP` / `BLOCKED_MISSING_INPUT` with zeroed exposure; never falls back to `Math.sin()` in live mode.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 1, 20, 34).

### `POST /api/dsm`
- **Auth / Role**: Authenticated session.
- **Site Access**: Validated via `authorizeApiRequest()`.
- **Entitlement**: `DSM_RISK`.
- **Major Reads**: Authoritative 96-block drawal from `interval_data_96` (live mode) or validated demo arrays.
- **Major Writes**: Service-role upserts into `dsm_incidents` (idempotent window index).
- **Service Calls**: Python FastAPI (`POST /dsm`).
- **Fail-Closed Conditions**: Returns `is_suppressed: true` (`MISSING_DATA`) if scheduled or actual drawal contains nulls, non-finite values, or <96 blocks.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 6, 29, 30).

### `POST /api/bess`
- **Auth / Role**: Authenticated session.
- **Site Access**: Validated via `authorizeApiRequest()`.
- **Entitlement**: `BESS_ARBITRAGE`.
- **Major Reads**: `bess_assets` (capacity, efficiency, degradation cost), day-ahead price series.
- **Major Writes**: Service-role inserts into `bess_signal_runs`.
- **Service Calls**: Python FastAPI (`POST /bess/optimize`).
- **Fail-Closed Conditions**: Returns `SAFETY_INTERLOCK` if battery SOC is negative, $>100\%$, or maintenance lock is engaged.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 7).

### `GET /api/compliance`
- **Auth / Role**: Authenticated session.
- **Site Access**: Validated for site state/discom context.
- **Entitlement**: `OA_COMPLIANCE`.
- **Major Reads**: `regulatory_sources` (inner joined on `status IN ('APPROVED', 'PUBLISHED')`), `compliance_obligations`, `discom_tariffs`.
- **Major Writes**: None (read-only customer portal).
- **Fail-Closed Conditions**: Unapproved rules (`REVIEW_PENDING`, `DRAFT`) are strictly suppressed. Mismatched voltage tariffs return `DATA GAP`.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 18, 33).

### `POST /api/renewables`
- **Auth / Role**: Authenticated session.
- **Site Access**: Validated.
- **Entitlement**: `RENEWABLE_PORTFOLIO`.
- **Major Reads**: `renewable_assets`, 96-block solar generation from `interval_data_96`, `emission_factors` (CEA v19).
- **Major Writes**: None.
- **Fail-Closed Conditions**: Live mode rejects scalar generation synthesis and demands 96-block measured intervals.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 19).

### `POST /api/reports/generate`
- **Auth / Role**: Authenticated (`ENERGY_MANAGER` or `ORGANISATION_ADMIN`).
- **Site Access**: Validated.
- **Entitlement**: Product-specific entitlement matching report type.
- **Major Reads**: Resolves underlying operational runs (`grid_forecast_runs`, `bess_signal_runs`, `dsm_incidents`).
- **Major Writes**: Generates CSV, uploads to private storage bucket `tenant-reports`, records entry in `report_records`.
- **Fail-Closed Conditions**: If underlying runs are absent, aborts generation without data fabrication.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 20, 32).

### `GET /api/reports/[id]/download`
- **Auth / Role**: Authenticated session.
- **Site Access**: Checks caller site access against `report_records.site_id`.
- **Entitlement**: Verifies caller org holds entitlement for the report's module.
- **Major Reads**: `report_records`, signed storage download stream.
- **Major Writes**: None.
- **Fail-Closed Conditions**: Returns 403 if site access or entitlement missing; returns 404 `REPORT_FILE_UNAVAILABLE` if storage object missing.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 32), `tests/e2e/persistence_journey.spec.ts`.

### `POST /api/alerts/[id]/acknowledge`
- **Auth / Role**: Authenticated (`OPERATOR`, `ENERGY_MANAGER`, or `ORGANISATION_ADMIN`).
- **Site Access**: Validated for alert's site.
- **Entitlement**: Base platform access.
- **Major Reads**: `alerts`.
- **Major Writes**: Calls RPC `acknowledge_alert_atomic` (updates alert status to `ACKNOWLEDGED` and inserts `ALERT_ACKNOWLEDGED` in `audit_logs`).
- **Fail-Closed Conditions**: Fails safely; returns HTTP 500 if database transaction aborts.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 20), `tests/e2e/demo_smoke.spec.ts`.

### `POST /api/billing/checkout` & `POST /api/webhooks/razorpay`
- **Auth / Role**: Checkout: `ORGANISATION_ADMIN`. Webhook: Unauthenticated endpoint with HMAC-SHA256 signature verification.
- **Major Reads**: `billing_checkout_sessions`, `subscription_items`.
- **Major Writes**: Inserts `subscriptions`, upserts `subscription_items`, updates `invoices`, records `audit_logs`.
- **Fail-Closed Conditions**: Webhook rejects invalid HMAC signature (400); quarantines unmapped session references without granting access.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 9, 10), `tests/integration/security_isolation.test.ts`.

### `GET /api/admin/audit`
- **Auth / Role**: Platform Admin only (`is_platform_admin === true`).
- **Major Reads**: `audit_logs`, `regulatory_sources`.
- **Fail-Closed Conditions**: Customer `ORGANISATION_ADMIN` accounts are rejected with 403 Forbidden.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 14).
