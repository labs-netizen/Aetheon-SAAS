# CURRENT_STATE.md — Verified Repository State

> **Last Updated**: September 2026 (Final Surgical Pre-Astra Correction Pass)  
> **Verification Baseline**: Full clean database reset, auth user seeding, linting (`npm run lint`), typecheck (`npm run typecheck`), Vitest (12 files, 105 tests), Pytest (1 file, 7 tests), Playwright Non-Demo (3 files, 12 tests), Playwright Demo (1 file, 12 tests), and Next.js production build (`npm run build`) executed cleanly.

## 1. Verified Metrics
- **Database Migrations**: 14 applied SQL migrations (`20260907000001` through `20260907000014_surgical_fixes_and_dsm_runs.sql`).
- **Next.js Production Build**: Succeeded (`npm run build`, exit code 0). 39 routes dynamically compiled on demand.
- **ESLint**: 0 errors (`npm run lint`, exit code 0).
- **TypeScript (`tsc --noEmit`)**: 0 errors (`npm run typecheck`, exit code 0).
- **Automated Test Scorecard (136 / 136 passing)**:
  - **Vitest**: **105 passed** (12 files, 100% pass rate) across unit, integration, live PostgreSQL RLS, audit chaining, adversarial API, and BESS live path suites.
  - **Python Pytest**: **7 passed** (1 file: `services/analytics/tests/test_analytics.py`, 100% pass rate) with explicit `ANALYTICS_SERVICE_TOKEN`.
  - **Playwright Non-Demo (Production-like)**: **12 passed** across 3 test files (`persistence_journey.spec.ts`: 1 passed; `real_auth_workflows.spec.ts`: 10 passed; `registration_journey.spec.ts`: 1 passed).
  - **Playwright Demo Mode**: **12 passed** (1 file: `demo_smoke.spec.ts`: 12 passed with `NEXT_PUBLIC_DEMO_MODE=true`).

---

## 2. Module Readiness Classifications

| Module / Area | Canonical Status | Rationale & Active State |
|---|---|---|
| **Core Tenancy & IAM** | `VERIFIED_IMPLEMENTED` | Multi-tenant orgs, sites, 6 platform roles, profile privilege escalation prevention, analyst expiry enforced. |
| **Site-Level Access** | `VERIFIED_IMPLEMENTED` | Enforced via `has_site_access()` in PostgreSQL RLS and `authorizeApiRequest()` in Next.js server guard. |
| **Data Ingestion (CSV)** | `VERIFIED_IMPLEMENTED` | Authoritative V1 contract: 1 CSV = 1 date = 96 rows contiguously indexed 1–96. Calendar validation prevents impossible dates (e.g. 2026-02-31). Atomic RPC `commit_ingestion_transaction`. |
| **Quality & Publication Gate** | `VERIFIED_IMPLEMENTED` | Canonical `PublicationGateStatus` enum, completeness threshold = 95.0%. Invariant: `validation_status = FAILED` and `publication_gate_status = PUBLISHABLE` is impossible. |
| **Product Catalogue & Entitlements** | `VERIFIED_IMPLEMENTED` | Canonical products with paise pricing; independent UI and API entitlement enforcement. |
| **Audit Logging System** | `VERIFIED_IMPLEMENTED` | SHA-256 hash chaining with transaction advisory lock and immutable triggers. |
| **Alert & Notification Hub** | `VERIFIED_LOCAL` (Ack/Audit) / `INTERNAL_VALIDATION` (Conditions) / `PRODUCTION_CONFIG_REQUIRED` (Outbound) | Alert persistence/retrieval verified local; atomic ack verified local; automated dispatch not implemented; outbound SMTP required. |
| **Common Report System** | `VERIFIED_IMPLEMENTED` | Fail-closed report generation. Rejects non-96 blocks or unpublishable quality; signed download URLs. |
| **Admin Console** | `VERIFIED_IMPLEMENTED` | Evidence-based launch checklist, non-platform admin access blocked, analyst expiry enforced. |
| **Grid Intelligence** | `INTERNAL_VALIDATION` | Dynamic highest-cost window & min/max prices derived from 96 blocks; approved DISCOM tariff required; live IEX clearing feed pending. |
| **DSM Risk Monitor** | `INTERNAL_VALIDATION` | 15-minute drawal deviation calculation; canonical `dsm_evaluation_runs` persisted for zero-incident proof; monetary exposure suppressed to 0 with `REGULATORY_CONFIGURATION_REQUIRED`. |
| **BESS Arbitrage** | `SPECIALIST_REVIEW_REQUIRED` | Live BESS solver execution, asset constraints, and `bess_signal_runs` persistence verified local; electrochemical engineer review pending. |
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
- **Exact V1 CSV Contract (Item 1)**: Both parser and database RPC independently enforce exactly 96 rows, 1 operating date, blocks 1–96, real calendar dates, and guarantee failed validation cannot become publishable.
- **Canonical Gate Model (Item 2)**: All components and endpoints reference single `PublicationGateStatus` vocabulary.
- **Fail-Closed Forecast & Reports (Items 3 & 5)**: Live Grid API and Report generator strictly reject missing/blocked quality and require exact 96 unique blocks.
- **DSM Run Proof (Item 6)**: `dsm_evaluation_runs` records every evaluation to prove zero-incident runs and differentiate them from data gaps in reports.
- **Billing Reference & Quarantine (Items 8 & 9)**: Webhook RPC inserts `billing_provider_ref` and quarantines unmapped provider events durably in `processed_webhook_events` without transaction rollback.
- **Non-Demo Persistence Journey (Item 10)**: 100% verified using seeded non-demo entity `Kalyani Bharat Forgings Ltd` / `Kalyani Pune Heavy Forge Unit 1` without demo bypass.
