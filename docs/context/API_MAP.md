# API_MAP.md — Authoritative Next.js & Analytics API Routes

This map documents the core Next.js API route handlers and Python FastAPI analytics service endpoints, authorization requirements, read/write patterns, and fail-closed conditions.

## 1. Route Registry

### `POST /api/ingestion/commit`
- **Auth / Role**: Authenticated (`ENERGY_MANAGER` or `ORGANISATION_ADMIN`).
- **Site Access**: Validated (`has_site_access(siteId)`).
- **Entitlement**: Verified (`GRID_INTELLIGENCE` or active base plan).
- **Contract Enforcement**: Enforces exact V1 CSV contract: exactly one operating date, exactly 96 rows, block indices 1–96 occurring exactly once, valid calendar date (e.g. rejects 2026-02-31). Rejects 95, 97, 192 rows. Computes SHA-256 for idempotency.
- **Major Reads**: Multipart CSV file stream.
- **Major Writes**: Calls canonical RPC `commit_ingestion_transaction` (inserts `ingestion_runs`, upserts `interval_data_96`, updates `sites.activation_status`, inserts `audit_logs`).
- **Service Calls**: None (pure PostgreSQL RPC).
- **Fail-Closed Conditions**: Returns 409 on duplicate SHA-256; returns 400 on contract violation (<96, >96, duplicate blocks, missing blocks, multiple dates, impossible dates). State `validation_status = 'FAILED' AND publication_gate_status = 'PUBLISHABLE'` is impossible.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 8, 9, 21), `tests/unit/csvParser.test.ts`, `tests/e2e/persistence_journey.spec.ts`.

### `POST /api/forecast`
- **Auth / Role**: Authenticated session.
- **Site Access**: Validated via `authorizeApiRequest(req, { siteId })`.
- **Entitlement**: `GRID_INTELLIGENCE`.
- **Major Reads**: `sites`, `interval_data_96` (96-block meter load), `discom_tariffs` (approved status verified).
- **Major Writes**: Service-role inserts into `grid_forecast_runs` and `grid_forecast_blocks` (canonical FK: `run_id`).
- **Service Calls**: Python FastAPI (`POST /v1/grid/forecast` on port 8000 with `ANALYTICS_SERVICE_TOKEN`).
- **Fail-Closed Conditions**: If telemetry is stale, site is uncalibrated (`CALIBRATING` / `AWAITING_DATA`), or approved tariff missing, returns `DATA_GAP` / `QUALITY_UNKNOWN` / `BLOCKED_MISSING_INPUT` with zeroed exposure; never defaults solver metadata to PASSED/RECENT; never falls back to `Math.sin()` in live mode.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 1, 3, 20, 34), `tests/e2e/persistence_journey.spec.ts`.

### `POST /api/dsm`
- **Auth / Role**: Authenticated session.
- **Site Access**: Validated via `authorizeApiRequest()`.
- **Entitlement**: `DSM_RISK`.
- **Major Reads**: Authoritative 96-block drawal from `interval_data_96` (live mode) or validated demo arrays.
- **Major Writes**: Service-role upserts into `dsm_incidents` (idempotent window index); writes atomic evaluation run to `dsm_evaluation_runs` even when zero material incidents are detected.
- **Service Calls**: Python FastAPI (`POST /v1/dsm/deviation`).
- **Fail-Closed Conditions**: Returns `is_suppressed: true` (`MISSING_DATA`) if scheduled or actual drawal contains nulls, non-finite values, or <96 blocks. Technical risk classification continues while monetary exposure is suppressed to 0 with `monetary_exposure_status: 'REGULATORY_CONFIGURATION_REQUIRED'`.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 6, 23, 29, 30).

### `POST /api/bess`
- **Auth / Role**: Authenticated session.
- **Site Access**: Validated via `authorizeApiRequest()`.
- **Entitlement**: `BESS_ARBITRAGE`.
- **Major Reads**: `bess_assets` (capacity, efficiency, degradation cost), site approved tariffs, battery telemetry.
- **Major Writes**: Service-role inserts into `bess_signal_runs`.
- **Service Calls**: Python FastAPI (`POST /v1/bess/optimise-demo`).
- **Fail-Closed Conditions**: Returns `SAFETY_INTERLOCK` if battery SOC is negative, $>100\%$, below minimum reserve (<10%), or maintenance lock is engaged.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 7, 22).

### `GET /api/compliance`
- **Auth / Role**: Authenticated session.
- **Site Access**: Validated for site state/discom context.
- **Entitlement**: `OA_COMPLIANCE`.
- **Major Reads**: `regulatory_sources` (inner joined on `status IN ('APPROVED', 'PUBLISHED')`), `compliance_obligations`, `discom_tariffs`.
- **Major Writes**: None (read-only customer portal).
- **Fail-Closed Conditions**: Unapproved rules (`REVIEW_PENDING`, `DRAFT`) are strictly suppressed. Mismatched voltage tariffs return `DATA_GAP`.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 14, 33).

### `POST /api/renewables`
- **Auth / Role**: Authenticated session.
- **Site Access**: Validated.
- **Entitlement**: `RENEWABLE_PORTFOLIO`.
- **Major Reads**: `renewable_assets`, 96-block solar generation from `interval_data_96`, `emission_factors` (CEA v19).
- **Major Writes**: None.
- **Service Calls**: Python FastAPI (`POST /v1/renewables/reconcile`).
- **Fail-Closed Conditions**: Live mode rejects scalar generation synthesis and demands 96-block measured intervals.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 19).

### `POST /api/reports/generate`
- **Auth / Role**: Authenticated (`ENERGY_MANAGER` or `ORGANISATION_ADMIN`).
- **Site Access**: Validated.
- **Entitlement**: Product-specific entitlement matching report type.
- **Major Reads**: Resolves underlying operational runs (`grid_forecast_runs`, `bess_signal_runs`, `dsm_evaluation_runs`, `dsm_incidents`).
- **Major Writes**: Generates CSV, uploads to private storage bucket `tenant-reports`, records entry in `report_records`.
- **Fail-Closed Conditions**: 
  - `GRID_DAILY_BRIEF` / `GRID_MONTHLY_REPORT`: Aborts with 422 `REPORT_NOT_PUBLISHABLE` or `DATA_GAP` if forecast run missing, quality not publishable (`PUBLISHABLE` or `PUBLISHABLE_WITH_WARNING`), freshness not `RECENT`, or validation not `PASSED`.
  - `BESS_PERFORMANCE_REPORT`: Aborts with 422 `NO_BESS_RUNS` if no optimization run exists for date.
  - `DSM_MONTHLY_REVIEW`: Queries `dsm_evaluation_runs`; if an evaluation run occurred but 0 incidents were flagged, generates report indicating `NO_MATERIAL_INCIDENTS`; returns 422 `REPORT_DATA_GAP` only if no evaluation runs exist.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 20, 22, 23, 32).

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
- **Major Writes**: RPC `process_razorpay_webhook_atomic` inserts `subscriptions` using canonical `billing_provider_ref`, upserts `subscription_items`, updates `invoices`, records `audit_logs`.
- **Fail-Closed Conditions**: 
  - Rejects invalid HMAC signature (400).
  - Unmapped checkout reference writes `processed_webhook_events` with status `'QUARANTINED'` and returns 422 `UNMAPPED_BILLING_REFERENCE` without throwing a rolling-back `RAISE EXCEPTION`, preserving durable quarantine while granting NO entitlements.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 18, 19), `tests/integration/security_isolation.test.ts`.

### `GET /api/admin/audit`
- **Auth / Role**: Platform Admin only (`is_platform_admin === true`).
- **Major Reads**: `audit_logs`, `regulatory_sources`.
- **Fail-Closed Conditions**: Customer `ORGANISATION_ADMIN` accounts are rejected with 403 Forbidden.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 14).

## 2. Python FastAPI Analytics Microservice Endpoints (Port 8000)

- `GET /health`: Health and readiness probe returning service status and microservice version.
- `POST /v1/grid/forecast`: Computes 96-block day-ahead demand profile and baseline landed cost from 96-block meter inputs.
- `POST /v1/dsm/deviation`: Evaluates 96-block actual vs scheduled drawals, flags incident windows, applies frequency penalties.
- `POST /v1/bess/optimise-demo`: Evaluates charge/discharge arbitrage schedule respecting battery capacity, C-rate, and degradation cost.
- `POST /v1/renewables/reconcile`: Reconciles measured vs modeled vs estimated generation and calculates avoided emissions using CEA factors.
- **Security & Hygiene**: Requires `Authorization: Bearer <ANALYTICS_SERVICE_TOKEN>`. Fails closed if token is missing or mismatched in production, staging, and local environments. Tested in `services/analytics/tests/test_analytics.py`.

