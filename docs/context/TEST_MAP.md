# TEST_MAP.md — Requirement to Automated Test Mapping

This map details the automated test suites, testing targets, and exact requirement coverage across the platform.

## 1. Test Suite Categories & Environments

| Category | Framework | Execution Engine | Test Files | Total Tests | Status |
|---|---|---|---|---|---|
| **UNIT (Core Logic & Parsers)** | Vitest v2.1 | Node.js (in-memory) | 7 files | 42 tests | 100% passed (42/42) |
| **DATABASE / RLS** | Vitest v2.1 | Live Docker PostgreSQL 17 (`:15432`) | 1 file | 11 tests | 100% passed (11/11) |
| **AUDIT CHAINING** | Vitest v2.1 | Live Docker PostgreSQL 17 (`:15432`) | 1 file | 5 tests | 100% passed (5/5) |
| **SECURITY ISOLATION** | Vitest v2.1 | Next.js API Handlers + Live DB | 1 file | 10 tests | 100% passed (10/10) |
| **ADVERSARIAL API** | Vitest v2.1 | Next.js Handlers + Live DB + Analytics | 1 file | 24 tests | 100% passed (24/24) |
| **BESS LIVE PATH** | Vitest v2.1 | Live DB + BESS Signal Engine | 1 file | 13 tests | 100% passed (13/13) |
| **AUTHORITY & AUDITABILITY** | Vitest v2.1 | Next.js Handlers + Live DB + Webhook | 1 file | 16 tests | 100% passed (16/16) |
| **PYTHON ANALYTICS** | Pytest 9.1 | Python 3.12 / FastAPI microservice | 1 file | 7 tests | 100% passed (7/7) |
| **PLAYWRIGHT NON-DEMO** | Playwright | Chromium Headless (`:3000`) | 3 files | 12 tests | 100% passed (12/12) |
| • `persistence_journey.spec.ts` | Playwright | Chromium + Local Supabase Auth/DB | 1 journey | 1 test | 100% passed (1/1) |
| • `real_auth_workflows.spec.ts` | Playwright | Chromium + Local Supabase Auth/DB | 10 flows | 10 tests | 100% passed (10/10) |
| • `registration_journey.spec.ts` | Playwright | Chromium + GoTrue Registration | 1 journey | 1 test | 100% passed (1/1) |
| **PLAYWRIGHT DEMO** | Playwright | Chromium Headless (`:3000`) | 1 file | 12 tests | 100% passed (12/12) |
| • `demo_smoke.spec.ts` | Playwright | Explicit `NEXT_PUBLIC_DEMO_MODE=true` | 12 tests | 12 tests | 100% passed (12/12) |
| **TOTAL VERIFIED** | | | **18 files** | **152 tests** | **100% (152/152)** |

---

## 2. Requirement-to-Test Traceability Matrix

### 1. Authoritative V1 CSV Contract (Item 1)
- **Requirement**: One CSV = One operating_date = Exactly 96 contiguous rows 1–96. Rejects 95, 97, 192 rows, duplicate blocks, missing blocks, multiple dates, impossible calendar dates (e.g. 2026-02-31). `validation_status = 'FAILED'` and `publication_gate_status = 'PUBLISHABLE'` is strictly impossible.
- **Proving Test**: `tests/unit/csvParser.test.ts`, `tests/integration/adversarial_api.test.ts` (Test 8).
- **Target**: `src/features/ingestion/csvParser.ts` + Migration 14 RPC `commit_ingestion_transaction`.

### 2. Canonical Publication Gate Model (Item 2)
- **Requirement**: Unified `PublicationGateStatus` vocabulary across types, quality gate engine, and database contracts. Single canonical completeness threshold (95.0%).
- **Proving Test**: `tests/unit/qualityGate.test.ts`, `tests/integration/adversarial_api.test.ts` (Test 5).
- **Target**: `src/types/index.ts`, `src/types/publication-gate.ts`, `src/features/quality/qualityGate.ts`.

### 3. Grid Server Quality Fail-Closed (Item 3)
- **Requirement**: `/api/forecast` requires authoritative conditions for live publication. Never defaults live solver metadata to PASSED/RECENT when absent; suppresses or returns DATA_GAP / QUALITY_UNKNOWN.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 4, 5).
- **Target**: `src/app/api/forecast/route.ts`.

### 4. Remove Remaining Live Grid Hardcodes (Item 4)
- **Requirement**: For live sites, dynamically derive high-cost windows and min/max prices from returned 96 blocks; resolve approved persisted tariffs; display CONFIGURATION REQUIRED on missing config; never default live validation/freshness to PASSED/RECENT.
- **Proving Test**: `tests/e2e/persistence_journey.spec.ts`, `tests/e2e/real_auth_workflows.spec.ts` (Test 3).
- **Target**: `src/app/grid-intelligence/page.tsx`.

### 5. Fail-Closed Grid Report Generation (Item 5)
- **Requirement**: `/api/reports/generate` requires applicable forecast run, exactly 96 unique blocks 1–96, publishable quality evidence, valid freshness, and passed validation. Rejects 95 blocks, missing quality, or blocked quality with `REPORT_NOT_PUBLISHABLE` / `DATA_GAP`.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 20: 95 blocks rejected, missing quality rejected, blocked quality rejected, 96 valid blocks successfully generate report).
- **Target**: `src/app/api/reports/generate/route.ts`.

### 6. Canonical DSM Evaluation-Run Proof (Item 6)
- **Requirement**: Persist canonical `dsm_evaluation_runs` record containing site_id, operating_date, calculation timestamp, rule version, and status, even when zero incidents occur. `DSM_MONTHLY_REVIEW` uses this to distinguish `NO_MATERIAL_INCIDENTS` from `REPORT_DATA_GAP`.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 23).
- **Target**: Migration 14 table `dsm_evaluation_runs`, `src/app/api/dsm/route.ts`, `src/app/api/reports/generate/route.ts`.

### 7. Live DSM Rule Authority (Item 7)
- **Requirement**: Technical deviation classification continues; monetary exposure without approved regulatory configuration is suppressed with `REGULATORY_CONFIGURATION_REQUIRED`. Demo rates are never presented as authoritative live monetary exposure.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 6, 29).
- **Target**: `src/app/api/dsm/route.ts`.

### 8. Billing First-Payment & Subscription Creation (Item 8)
- **Requirement**: Migration 12/14 atomic RPC inserts into canonical `billing_provider_ref`. Brand-new organisation with no prior subscription correctly creates subscription, subscription item, entitlement, and invoice.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 18).
- **Target**: Migration 14 RPC `process_razorpay_webhook_atomic`.

### 9. Durable Webhook Quarantine (Item 9)
- **Requirement**: Unmapped or invalid billing provider references insert a durable event into `processed_webhook_events` with status `QUARANTINED` without granting entitlements and without rolling back the quarantine insert.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 19).
- **Target**: Migration 14 RPC `process_razorpay_webhook_atomic`.

### 10. Real Non-Demo Persistence E2E (Item 10)
- **Requirement**: Seeded non-demo organisation, non-demo site (`is_demo = false`), real auth login $\to$ raw 96-block CSV import $\to$ CALIBRATING state $\to$ parameter save $\to$ server forecast run $\to$ report generation $\to$ report download $\to$ logout/relogin persistence.
- **Proving Test**: `tests/e2e/persistence_journey.spec.ts` (100% non-demo flow, 43.4s).
- **Target**: `tests/e2e/persistence_journey.spec.ts`.

### 11. Playwright Project Separation & CI Truth (Item 11)
- **Requirement**: Retired redundant `platform_workflows.spec.ts`. Configured separate `--project=non-demo` and `--project=demo`. Dynamic demo mode evaluated at runtime without static build leakage.
- **Proving Test**: `npx playwright test --project=non-demo` (12 passed), `npx playwright test --project=demo` (12 passed).
- **Target**: `playwright.config.ts`, `.github/workflows/ci.yml`.

### 12. Honest Alert System Classification (Item 12)
- **Requirement**: Alert persistence/retrieval = `VERIFIED_LOCAL`. Alert acknowledgement/audit = `VERIFIED_LOCAL`. Automated condition generation = `INTERNAL_VALIDATION`. Outbound email = `PRODUCTION_CONFIG_REQUIRED`.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 21).
- **Target**: Migration 13 RPC `acknowledge_alert_atomic`, `docs/context/modules/ALERTS.md`.

### 13. Analytics Token Hygiene (Item 13)
- **Requirement**: `services/analytics/main.py` fails closed in production and staging if `ANALYTICS_SERVICE_TOKEN` is unset. Local and CI environments require explicit tokens.
- **Proving Test**: `services/analytics/tests/test_analytics.py`, API guard tests.
- **Target**: `services/analytics/main.py`.

### 14. Product Readiness Reconciliation (Item 14)
- **Requirement**: Grid Intelligence = `INTERNAL_VALIDATION`, DSM Risk = `INTERNAL_VALIDATION`, OA Compliance = `SPECIALIST_REVIEW_REQUIRED`, BESS Arbitrage = `SPECIALIST_REVIEW_REQUIRED`, Renewable Portfolio = `DEMO`, Billing = `PRODUCTION_CONFIG_REQUIRED`.
- **Proving Test**: `src/lib/constants/products.ts`, `tests/integration/adversarial_api.test.ts`.
- **Target**: Product catalog constants and context documentation.

### 15. BESS Live Database & Report Path (Item 16)
- **Requirement**: Non-demo BESS site $\to$ persisted active `bess_assets` $\to$ fresh interval telemetry $\to$ 96-block price curve $\to$ `POST /api/bess` $\to$ Python solver execution $\to$ `bess_signal_runs` persistence $\to$ `BESS_PERFORMANCE_REPORT` generation.
- **Proving Test**: `tests/integration/adversarial_api.test.ts` (Test 7: negative SOC validation; Test 22: live BESS solver execution, run persistence, and `BESS_PERFORMANCE_REPORT` generation).
- **Target**: `src/app/api/bess/route.ts`, `src/app/api/reports/generate/route.ts`.
