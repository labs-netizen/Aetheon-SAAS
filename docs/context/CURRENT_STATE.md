# CURRENT_STATE.md — Verified Repository State

> **Last Updated**: September 2026  
> **Verification Baseline**: Full clean database reset, linting, typecheck, Vitest, Pytest, Playwright, and production build executed.

## 1. Verified Metrics
- **Git Commit Checkpoint**: `1a738c25a9649f460bda0dd9b93456b6cf76a933`
- **Database Migrations**: 13 applied SQL migrations (`20260907000001` through `20260907000013_atomic_acknowledgement_audit.sql`).
- **Next.js Production Build**: Succeeded (`next build`, exit code 0). 39 routes compiled (24 static, 15 dynamic).
- **ESLint**: 0 errors (3 hook dependency warnings on optional useEffect arrays).
- **TypeScript (`tsc --noEmit`)**: 0 errors.
- **Automated Test Scorecard (106 / 106 passing)**:
  - **Vitest**: 85 passed (11 files, 100% pass rate) across unit, integration, live PostgreSQL RLS, audit chaining, and adversarial API suites.
  - **Python Pytest**: 7 passed (1 file: `services/analytics/tests/test_analytics.py`, 100% pass rate).
  - **Playwright E2E**: 14 passed across 3 suites (`demo_smoke.spec.ts`: 12 passed; `registration_journey.spec.ts`: 1 passed; `persistence_journey.spec.ts`: 1 passed). Note: `real_auth_workflows.spec.ts` (10 tests) cleanly skips when external non-demo credentials are not supplied.

## 2. Module Readiness Classifications

| Module / Area | Status | Rationale & Active State |
|---|---|---|
| **Core Tenancy & IAM** | `VERIFIED_IMPLEMENTED` | Multi-tenant orgs, sites, 6 roles, metadata escalation blocked, analyst expiry enforced. |
| **Site-Level Access** | `VERIFIED_IMPLEMENTED` | Enforced via `has_site_access()` in PostgreSQL RLS and `authorizeApiRequest()` in Next.js. |
| **Data Ingestion (CSV)** | `VERIFIED_IMPLEMENTED` | 96-block contiguous validator, SHA-256 idempotency, atomic commit RPC `commit_ingestion_transaction`. |
| **Quality & Publication Gate** | `VERIFIED_IMPLEMENTED` | Server-authoritative gating (`PUBLISHABLE`, `BLOCKED_STALE`, `BLOCKED_INCOMPLETE`, `BLOCKED_MISSING_INPUT`). |
| **Product Catalogue & Entitlements** | `VERIFIED_IMPLEMENTED` | 5 products with paise pricing; independent UI and API entitlement enforcement. |
| **Audit Logging System** | `VERIFIED_IMPLEMENTED` | SHA-256 hash chaining with transaction advisory lock and immutable triggers. |
| **Alert & Notification Hub** | `VERIFIED_IMPLEMENTED` | Deduplication cooldown, lifecycle templates, atomic acknowledgment RPC with audit logging. |
| **Common Report System** | `VERIFIED_IMPLEMENTED` | Canonical `report_records` schema, private storage path, `/api/reports/[id]/download` routing. |
| **Admin Console** | `VERIFIED_IMPLEMENTED` | Evidence-based launch checklist, customer blocked, analyst expiry enforced. |
| **Grid Intelligence** | `INTERNAL_VALIDATION` | Server-driven 96-block forecast, Cost Explorer; live IEX market calibration pending. |
| **DSM Risk Monitor** | `INTERNAL_VALIDATION` | 15-minute scheduled vs actual deviation, quiet hours, atomic incident acknowledgment. |
| **BESS Arbitrage** | `SPECIALIST_REVIEW_REQUIRED` | Advisory charge/discharge windows, SOC safety interlocks; electrochemical engineer review pending. |
| **Open Access Compliance** | `SPECIALIST_REVIEW_REQUIRED` | 7-stage governance, approval gate, voltage matching, dynamic obligations; legal signoff pending. |
| **Renewable Portfolio** | `DEMO_ONLY` | Measured vs modelled solar tracking, CEA v19 emission factor; Modbus inverter connection pending. |
| **Billing & Razorpay Webhooks** | `PRODUCTION_CONFIG_REQUIRED` | Local checkout mapping, atomic webhook RPC; live merchant KYC and production webhook secret pending. |
| **Platform MFA / AAL2** | `PRODUCTION_CONFIG_REQUIRED` | Production AAL2 authenticator provider setup in Supabase Auth required. |

## 3. Demo vs. Live Rules (Fail-Closed Invariants)
- **Demo Mode**: Active only when `NEXT_PUBLIC_DEMO_MODE === 'true'` AND `site.is_demo === true`. All demo indicators render `DEMO DATA / UNVERIFIED`.
- **Live Mode**: Never manufactures or falls back to synthetic operational data (no `Math.sin()`, no fake schedules, no fabricated tariff rates). When interval data, telemetry, or tariffs are missing or uncalibrated, live routes return structured `DATA GAP` / `CONFIGURATION REQUIRED` / `MISSING_DATA` / `SAFETY_INTERLOCK`.

## 4. Key Architectural Decisions
- **Atomic Acknowledgments (Migration 13)**: Alerts and DSM incidents are updated and audited within a single transaction via `acknowledge_alert_atomic` and `acknowledge_dsm_incident_atomic`.
- **Server-Authoritative Outputs**: Operational output tables (`forecast_runs`, `grid_forecast_blocks`, `bess_signal_runs`, `dsm_incidents`, `data_quality_evaluations`, `report_records`) block direct client writes via RLS and require backend service-role execution.
- **Multipart Checksums**: CSV ingestion computes SHA-256 on the incoming binary/stream server-side to prevent duplicate or falsified client payloads.
