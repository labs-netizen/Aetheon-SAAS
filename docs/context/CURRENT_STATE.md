# CURRENT_STATE.md — Verified Repository State

> **Last Updated**: September 10, 2026 (Astra Passes 1–3 and Final Acceptance Freeze)
> **Verification Baseline**: Clean database reset and auth user seeding completed before final verification. Linting (`npm run lint`), typecheck (`npm run typecheck`), Vitest (22 files, 266 tests), Pytest (1 file, 7 tests), Playwright Non-Demo (3 files, 12 tests), Playwright Demo (1 file, 12 tests), Next.js production build (`npm run build`), and context-map validation all executed successfully.

## 1. Verified Metrics
- **Database Migrations**: 22 applied SQL migrations (`20260907000001` through `20260909000022_operational_mutation_rbac.sql`).
- **Next.js Production Build**: Succeeded (`npm run build`, exit code 0). 39 routes dynamically compiled on demand.
- **ESLint**: 0 errors (`npm run lint`, exit code 0).
- **TypeScript (`tsc --noEmit`)**: 0 errors (`npm run typecheck`, exit code 0).
- **Database Security Catalog**: PASS. All nine audited tenant tables have RLS enabled; no non-SELECT policies remain on audited tables; all public `SECURITY DEFINER` functions have the fixed search path; no client execution privilege remains on mutating definers; no client table write grants remain on audited tables.
- **Automated Test Scorecard (297 / 297 passing)**:
  - **Vitest**: **266 passed** (22 files, 100% pass rate) across unit, integration, live PostgreSQL RLS, audit chaining, adversarial API, domain-safety, authority, and auditability suites.
  - **Python Pytest**: **7 passed** (1 file: `services/analytics/tests/test_analytics.py`, 100% pass rate) with explicit `ANALYTICS_SERVICE_TOKEN`.
  - **Playwright Non-Demo (Production-like)**: **12 passed** across 3 test files (`persistence_journey.spec.ts`: 1 passed; `real_auth_workflows.spec.ts`: 10 passed; `registration_journey.spec.ts`: 1 passed).
  - **Playwright Demo Mode**: **12 passed** (1 file: `demo_smoke.spec.ts`: 12 passed with `NEXT_PUBLIC_DEMO_MODE=true`).

---

## 2. Module Readiness Classifications

| Module / Area | Canonical Status | Rationale & Active State |
|---|---|---|
| **Core Tenancy & IAM** | `VERIFIED_IMPLEMENTED` | Multi-tenant orgs, sites, 6 platform roles, profile privilege escalation prevention, analyst expiry enforced. Zero free paid entitlements on creation for non-demo orgs. |
| **Site-Level Access** | `VERIFIED_IMPLEMENTED` | Enforced via `has_site_access()` in PostgreSQL RLS and `authorizeApiRequest()` in Next.js server guard. Customer activation fields blocked with 400. |
| **Data Ingestion (CSV)** | `VERIFIED_IMPLEMENTED` | Authoritative V1 contract: 1 CSV = 1 date = 96 rows contiguously indexed 1–96. Calendar validation prevents impossible dates. Atomic RPC `commit_ingestion_transaction` transitions CALIBRATING -> ACTIVE upon 7 valid days and inserts into `site_activation_history`. |
| **Quality & Publication Gate** | `VERIFIED_IMPLEMENTED` | Canonical `PublicationGateStatus` enum, completeness threshold = 95.0%. Requires exact operating date match in live mode. Invariant: `validation_status = FAILED` and `publication_gate_status = PUBLISHABLE` is impossible. |
| **Product Catalogue & Entitlements** | `VERIFIED_IMPLEMENTED` | Canonical products with paise pricing; independent UI and API entitlement enforcement. Paid entitlements require validated payment webhook. |
| **Audit Logging System** | `VERIFIED_IMPLEMENTED` | Canonical schema (`action`, `entity_type`, `entity_id`, `details`). SHA-256 hash chaining via `encode(sha256())` with transaction advisory lock and immutable triggers. |
| **Alert & Notification Hub** | `VERIFIED_LOCAL` (Ack/Audit) / `INTERNAL_VALIDATION` (Conditions) / `PRODUCTION_CONFIG_REQUIRED` (Outbound) | Alert persistence/retrieval verified local; atomic ack verified local; automated dispatch not implemented; outbound SMTP required. |
| **Common Report System** | `VERIFIED_IMPLEMENTED` | Fail-closed report generation. Rejects non-96 blocks or unpublishable quality; signed download URLs. |
| **Admin Console** | `VERIFIED_IMPLEMENTED` | Evidence-based launch checklist, non-platform admin access blocked, analyst expiry enforced. |
| **Grid Intelligence** | `INTERNAL_VALIDATION` | Live output is suppressed unless a validated live model and authoritative price feed are available. No synthetic or internally unvalidated 96-block forecast is published; live IEX clearing feed and model validation remain pending. |
| **DSM Risk Monitor** | `INTERNAL_VALIDATION` | 15-minute drawal deviation calculation; rules resolved via `regulatory_domain = 'DSM'`; monetary exposure suppressed with `REGULATORY_CONFIGURATION_REQUIRED` on missing approved rule; canonical `dsm_evaluation_runs` persisted for zero-incident proof. |
| **BESS Arbitrage** | `SPECIALIST_REVIEW_REQUIRED` | Live BESS solver execution, browser SOC ignored, asset constraints `min_soc_pct <= current_soc_pct <= max_soc_pct`, and `bess_signal_runs` persistence verified local; electrochemical engineer review pending. |
| **Open Access Compliance** | `SPECIALIST_REVIEW_REQUIRED` | Relational rules engine, approval gate, voltage matching, dynamic obligations; legal signoff pending. |
| **Renewable Portfolio** | `DEMO` | Measured vs modelled solar tracking, CEA v19 emission factor; Modbus inverter connection pending. |
| **Billing & Razorpay Webhooks** | `PRODUCTION_CONFIG_REQUIRED` | Canonical `billing_provider_ref` model; first-payment brand-new org flow verified; durable webhook quarantine verified. Live merchant keys pending. |
| **Platform MFA / AAL2** | `PRODUCTION_CONFIG_REQUIRED` | Production AAL2 authenticator provider setup in Supabase Auth required. |

---

## 3. Demo vs. Live Rules (Fail-Closed Invariants)
- **Demo Mode**: Active only when `NEXT_PUBLIC_DEMO_MODE === 'true'` AND `site.is_demo === true`. All demo indicators render `DEMO DATA / UNVERIFIED`.
- **Live Mode**: Never manufactures or falls back to synthetic operational data (no `Math.sin()`, no fake schedules, no fabricated tariff rates). When interval data, telemetry, or tariffs are missing or uncalibrated, live routes return structured `DATA GAP` / `CONFIGURATION REQUIRED` / `MISSING_DATA` / `REGULATORY_CONFIGURATION_REQUIRED` / `SAFETY_INTERLOCK`.

---

## 4. Key Architectural Decisions Verified
- **Customer Activation Bypass Eliminated (Item 1)**: `PATCH /api/sites/[id]` rejects `activation_status`, `activation_reason`, and `last_status_change` with 400.
- **Atomic Activation History in Ingestion RPC (Item 2)**: `commit_ingestion_transaction` updates site status and atomically records a row in `site_activation_history` without duplicate rows on unchanged status.
- **Real Non-Demo E2E State Machine Proof (Item 3)**: `persistence_journey.spec.ts` proves transition from CALIBRATING to ACTIVE via 7th 96-block day upload through the real ingestion API.
- **Canonical Audit Write Contract (Item 4)**: `recordAuditEvent()` emits only real schema columns; `chain_audit_log` uses standard SHA-256.
- **Zero Free Paid Entitlements (Item 5)**: New customer organisations start with 0 active paid entitlements until a validated payment webhook executes.
- **Grid Quality Date & Approved Tariff Authority (Item 6)**: `/api/forecast` evaluates quality for the requested `operatingDate` only, enforces exact voltage category and effective dates with approved regulatory sources, and suppresses live output with `LIVE_MODEL_AND_PRICE_FEED_REQUIRED` until validated model/feed authority exists.
- **Live Grid UI Fabrication Removed (Item 7)**: Removed fabricated forecast fallbacks and fake PASSED defaults; the UI surfaces the explicit suppression state and does not render forecast blocks while live authority is unavailable.
- **DSM Rule Domain Resolution (Item 8)**: Resolves rules via `regulatory_domain = 'DSM'`, fails closed on unapproved rules, renders actual status.
- **BESS Safety Authority (Item 9)**: Ignores browser `initialSocPct`, enforces `min_soc_pct <= current_soc_pct <= max_soc_pct`, returns `SAFETY_INTERLOCK`.
- **Product Readiness Consistency (Item 10)**: Single source of truth in `src/lib/constants/index.ts`.
