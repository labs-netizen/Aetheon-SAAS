# HANDOFF TO ASTRA - Specialist Engineering & Security Audit Directive (HANDOFF_TO_ASTRA.md)

## 1. Executive Summary & Repository State

This document serves as the formal handover specification from the **Antigravity implementation phase** to the **Astra specialist engineering and audit phase**.

Antigravity has constructed the complete first major production-oriented foundation of the **Aetheon Energy Intelligence Platform** (`aetheon-saas`), covering ~70% of total repository engineering effort:
- Modern Next.js 14 modular monolith application with TypeScript (strict) and Tailwind CSS.
- Production PostgreSQL migrations and Row Level Security policies (`supabase/migrations/00001_core_tenancy.sql` through `00007_rls_policies.sql`).
- Central Data Quality & Publication Quality Gate with hard suppression on stale or incomplete data (`src/features/quality/qualityGate.ts`).
- Indian 15-minute 96-block electricity time utilities (`src/lib/dates/blocks96.ts`).
- Centralized Entitlement Engine decoupled from monitoring activation status (`src/features/entitlements/service.ts`).
- 5-stage Operational Activation State Machine (`src/features/onboarding/stateMachine.ts`).
- Complete CSV/XLSX 15-minute AMR ingestion gateway with SHA-256 duplicate detection and row-level error reporting (`src/features/ingestion/csvParser.ts`).
- Deepest commercial implementation delivered for **Grid Intelligence Monitor** (`src/app/grid-intelligence/page.tsx`).
- Functional demo implementations for Open Access Compliance, DSM Risk Monitor, BESS Arbitrage, and Renewable Portfolio with prominent `DEMO / UNVERIFIED` badges.
- Decoupled Python FastAPI analytics engine with deterministic numerical solvers (`services/analytics/`).
- Automated test suites (Vitest unit/integration tests & Pytest analytics tests).

---

## 2. Implementation Inventory

### What is Fully Working (Production Foundation Ready)
1. **Application Shell & Navigation**: Responsive multi-tenant shell with organisation context, dynamic site selector, activation health badge, role switcher, and user menu (`src/components/layout/AppShell.tsx`).
2. **Indian 96-Block Time Engine**: Canonical conversion between Indian electricity blocks 1–96, operating dates, and UTC/IST ISO timestamps (`src/lib/dates/blocks96.ts`).
3. **Data Gateway (CSV Ingestion)**: Ingestion parser, SHA-256 checksum duplicate rejection, 96-block contiguity validation, and template generation (`src/features/ingestion/csvParser.ts`).
4. **Central Publication Quality Gate**: Evaluation engine enforcing hard suppression of actionable recommendations when telemetry is stale (>24h) or incomplete (<90%) (`src/features/quality/qualityGate.ts`).
5. **Decoupled Activation Machine**: 5-state lifecycle (`CONFIGURED` → `AWAITING_DATA` → `CALIBRATING` → `ACTIVE` / `DEGRADED`) independent of payment status (`src/features/onboarding/stateMachine.ts`).
6. **Grid Intelligence Monitor**: Full end-to-end interface with Daily Grid Brief, 96-block interactive Recharts curve, 96-row tabular view, Cost Explorer (baseline vs solar vs BESS vs OA), and CSV/print export (`src/app/grid-intelligence/page.tsx`).
7. **Common Report Engine**: Snapshot provenance preservation (model version, generation timestamp, tariff version) (`src/app/reports/page.tsx`).
8. **Admin Launch Checklist**: 10-point commercial launch checklist, model registry, and immutable audit logs (`src/app/admin/page.tsx`).

### What is Demo / Synthetic (Clearly Stamped DEMO / UNVERIFIED)
1. **DISCOM Tariffs & DSM Rules**: Synthetic tariff values (e.g. MSEDCL HT-1 ₹7.45/kWh and ToD peak surcharges) are seeded for demonstration only in `supabase/seed.sql`.
2. **DSM Exposure Calculations**: Simple linear penalty calculation under demo rates; not yet certified against CERC DSM 2024 formal state-specific billing matrices.
3. **BESS Advisory Solver**: Deterministic heuristic solver in `services/analytics/solvers.py` verifying power and SOC bounds; not yet a commercial MILP degradation optimizer.
4. **Regulatory Sources**: Seeded orders marked `DEMO / UNVERIFIED` until reviewed by legal counsel.

---

## 3. Areas Requiring Specialist Review by Astra

The following areas are marked `SPECIALIST_REVIEW_REQUIRED`:

### 3.1 Tenant Isolation & Row Level Security (RLS)
- **Target File**: `supabase/migrations/20260907000007_rls_policies.sql`
- **Audit Requirement**:
  - Verify that `is_org_member()` and `has_org_role()` helper functions cannot be bypassed via SQL injection or subquery manipulation.
  - Test cross-tenant access resistance against malicious direct Supabase REST API queries.
  - Verify private storage bucket policies for uploaded AMR CSVs and generated report PDFs.

### 3.2 Privilege Escalation & Internal Roles
- **Target File**: `src/types/index.ts`, `src/features/entitlements/service.ts`, `supabase/migrations/20260907000001_core_tenancy.sql`
- **Audit Requirement**:
  - Ensure `AETHEON_ANALYST` access strictly enforces the `expires_at` timestamp in both application middleware and PostgreSQL RLS.
  - Verify that `AETHEON_REGULATORY_REVIEWER` cannot access customer billing data or trigger commercial refunds.

### 3.3 Payment Webhook Verification & Idempotency
- **Target File**: `src/features/billing/razorpayAdapter.ts`
- **Audit Requirement**:
  - Replace development signature bypass with strict mandatory cryptographic HMAC-SHA256 signature verification in production.
  - Implement replay-attack protection via unique webhook event ID tracking in PostgreSQL.

### 3.4 Regulatory Publication Quality Gate
- **Target File**: `src/app/compliance/page.tsx`, `supabase/migrations/20260907000004_regulatory_framework.sql`
- **Audit Requirement**:
  - Verify that no API endpoint or server-rendered component can deliver regulatory data with status `CHANGE_DETECTED/REVIEW_PENDING` to customer sessions.
  - Implement tamper-evident cryptographic signing of approved regulatory orders.

### 3.5 BESS Optimization Mathematics
- **Target File**: `services/analytics/solvers.py` (function `solve_bess_advisory`)
- **Audit Requirement**:
  - Transition from the baseline heuristic solver to a mixed-integer linear programming (MILP) solver optimizing joint time-of-day tariffs and battery degradation curves.
  - Maintain the strict advisory boundary ("Recommended opportunity windows") with zero physical SCADA dispatch.

### 3.6 CERC/SERC DSM State-Rule Mathematical Engine
- **Target File**: `services/analytics/solvers.py` (function `solve_dsm_deviation`)
- **Audit Requirement**:
  - Incorporate real-time Indian grid frequency linking (50 Hz ± 0.05 Hz) into deviation settlement surcharge multipliers per the CERC 2024 Deviation Settlement Regulations.

---

## 4. Recommended Astra Execution Order

1. **Phase A (Security & Tenancy Audit)**: Audit `supabase/migrations/20260907000007_rls_policies.sql` and run automated adversarial SQL queries.
2. **Phase B (Billing & Entitlement Hardening)**: Connect production Razorpay test webhooks and audit subscription transitions.
3. **Phase C (Regulatory Sourcing Verification)**: Replace synthetic regulatory seed data in `supabase/seed.sql` with verified tariff orders from MERC, GERC, and UPERC.
4. **Phase D (Advanced Mathematical Solvers)**: Enhance `services/analytics/solvers.py` with MILP optimization for BESS and frequency-linked DSM calculations.
5. **Phase E (External Penetration Testing)**: Commission independent third-party penetration testing prior to public commercial billing launch.
