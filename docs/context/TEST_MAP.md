# TEST_MAP.md — Requirement to Automated Test Mapping

This map details the automated test suites, testing targets, and exact requirement coverage across the platform.

## 1. Test Suite Categories & Environments

| Category | Framework | Execution Engine | Test Files | Total Tests | Pass Rate |
|---|---|---|---|---|---|
| **UNIT** | Vitest v2.1 | Node.js (in-memory) | 7 files | 30 tests | 100% (30/30) |
| **DATABASE / RLS** | Vitest v2.1 | Live Docker PostgreSQL 17.6 (`:15432`) | 1 file | 11 tests | 100% (11/11) |
| **AUDIT CHAINING** | Vitest v2.1 | Live Docker PostgreSQL 17.6 (`:15432`) | 1 file | 5 tests | 100% (5/5) |
| **SECURITY ISOLATION** | Vitest v2.1 | Node.js / Next.js Handlers | 1 file | 10 tests | 100% (10/10) |
| **ADVERSARIAL API** | Vitest v2.1 | Next.js API Handlers + Live DB | 1 file | 29 tests | 100% (29/29) |
| **PYTHON ANALYTICS** | Pytest 9.1 | Python 3.11 / FastAPI microservice | 1 file | 7 tests | 100% (7/7) |
| **PLAYWRIGHT DEMO** | Playwright | Chromium Headless (`:3000`) | 1 file | 12 tests | 100% (12/12) |
| **PLAYWRIGHT REGISTRATION** | Playwright | Chromium + Live PostgreSQL + GoTrue | 1 file | 1 test | 100% (1/1) |
| **PLAYWRIGHT PERSISTENCE** | Playwright | Chromium + Live PostgreSQL + Storage | 1 file | 1 test | 100% (1/1) |
| **PLAYWRIGHT REAL AUTH** | Playwright | Chromium Headless | 1 file | 10 tests | Skipped (awaits prod creds) |
| **TOTAL VERIFIED** | | | **16 files** | **106 tests** | **100% (106/106)** |

## 2. Requirement-to-Test Traceability Matrix

### 1. Multi-Tenant Isolation & RLS Boundary
- **Requirement**: Tenant A cannot read, insert, or mutate records in Tenant B; cross-tenant leakage blocked at engine level.
- **Proving Test**: `tests/integration/supabase_rls.test.ts` (Test 1, 2, 3), `tests/integration/adversarial_api.test.ts` (Test 2).
- **Target**: Live Docker PostgreSQL 17.6.

### 2. Granular Site-Level Access (`has_site_access`)
- **Requirement**: Site A access does NOT grant access to Site B within the same organisation.
- **Proving Test**: `tests/integration/supabase_rls.test.ts` (Test 8), `tests/integration/adversarial_api.test.ts` (Test 2, 3).
- **Target**: Live PostgreSQL RLS + `src/lib/auth/api-guard.ts`.

### 3. Exact 96-Block CSV Ingestion & Idempotency
- **Requirement**: Upload requires contiguous 1–96 blocks; duplicate SHA-256 rejected with HTTP 409; client JSON bypass blocked.
- **Proving Test**: `tests/unit/csvParser.test.ts`, `tests/integration/adversarial_api.test.ts` (Test 8), `tests/e2e/persistence_journey.spec.ts`.
- **Target**: Node.js parser + Migration 12 RPC `commit_ingestion_transaction`.

### 4. Server-Authoritative Operational Outputs
- **Requirement**: Operational tables (`forecast_runs`, `grid_forecast_blocks`, `bess_signal_runs`, `dsm_incidents`) reject direct client writes via RLS; service-role only.
- **Proving Test**: `tests/integration/supabase_rls.test.ts` (Test 10, 11).
- **Target**: Live Docker PostgreSQL 17.6 RLS engine.

### 5. Atomic Alert Acknowledgment & Audit
- **Requirement**: Acknowledging an alert atomically mutates status and creates an immutable audit record in a single transaction.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 20), `tests/e2e/demo_smoke.spec.ts` (Test 8).
- **Target**: Migration 13 RPC `acknowledge_alert_atomic`.

### 6. Atomic DSM Incident Acknowledgment & Audit
- **Requirement**: Acknowledging a DSM incident atomically updates `dsm_incidents` and writes an audit record.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 30).
- **Target**: Migration 13 RPC `acknowledge_dsm_incident_atomic`.

### 7. DSM Missing Data Safety Suppression
- **Requirement**: Null, undefined, or missing values in 96-block drawal arrays trigger `is_suppressed: true` with zero penalty.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 6, 29).
- **Target**: `src/app/api/dsm/route.ts` demo and live validation.

### 8. BESS Hardware Safety Interlocks
- **Requirement**: Negative or out-of-bounds battery SOC triggers backend `SAFETY_INTERLOCK` advisory suppression.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 7), `services/analytics/tests/test_analytics.py`.
- **Target**: Next.js BESS route + Python optimization solver.

### 9. Cryptographic Audit Chaining & Concurrency
- **Requirement**: SHA-256 hash chaining of audit events, immutable update/delete triggers, zero forks under concurrent inserts.
- **Proving Test**: `tests/integration/audit_chaining.test.ts` (5 tests).
- **Target**: Migration 11 trigger with `pg_advisory_xact_lock`.

### 10. Webhook Deduplication & Unique Subscriptions
- **Requirement**: Webhook events are transactionally deduplicated; duplicate subscription items prevented by unique index.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 9, 10), `tests/integration/security_isolation.test.ts`.
- **Target**: `billing_checkout_sessions` + `idx_subscription_items_unique`.

### 11. Analyst Expiry Constraint & API Enforcement
- **Requirement**: Write-time trigger rejects analyst role without $\le 24$ hour expiry; runtime guard blocks expired analysts.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 15, 17).
- **Target**: PostgreSQL trigger `trg_enforce_analyst_session_limit` + `src/lib/auth/api-guard.ts`.

### 12. Full Customer Persistence Journey
- **Requirement**: Real Login $\to$ Site Parameter Save $\to$ CSV Upload $\to$ Checksum $\to$ Forecast $\to$ Report Generation $\to$ Download $\to$ Alert Ack $\to$ Relogin.
- **Proving Test**: `tests/e2e/persistence_journey.spec.ts` (1 long-form journey test, 41s).
- **Target**: Full stack Chromium E2E.

### 13. Self-Service Customer Registration & Onboarding
- **Requirement**: New User Registration $\to$ Org Created $\to$ `ONBOARDING_REQUIRED` $\to$ First Site Configured $\to$ Dashboard `READY`.
- **Proving Test**: `tests/e2e/registration_journey.spec.ts` (1 journey test, 13s).
- **Target**: Full stack Chromium E2E.

### 14. Demo Mode Smoke Suite
- **Requirement**: Complete 12-test smoke run verifying dashboard, site switching, 96-block charts, banners, reports, and role switching.
- **Proving Test**: `tests/e2e/demo_smoke.spec.ts` (12 tests, 20s).
- **Target**: Full stack Chromium E2E in explicit demo mode.
