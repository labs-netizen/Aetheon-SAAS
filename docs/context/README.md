# Aetheon SaaS — Low-Token Persistent Context Layer

This directory provides a compact navigation and index layer for AI coding agents and developers. It indexes the core architectural pathways, database tables, security boundaries, APIs, tests, and module interfaces without reproducing massive source blocks.

## Index of Context Files

- **[`CURRENT_STATE.md`](CURRENT_STATE.md)**: Current commit, verified test counts, migration counts, build status, and known constraints.
- **[`CODEBASE_MAP.md`](CODEBASE_MAP.md)**: Directory layout, subsystem interactions, and high-level architectural flow.
- **[`DATABASE_MAP.md`](DATABASE_MAP.md)**: Database migrations, tables, schema relationships, and key RPCs.
- **[`SECURITY_MAP.md`](SECURITY_MAP.md)**: Tenancy, roles, RLS policies, Security Definer boundaries, and audit chaining.
- **[`API_MAP.md`](API_MAP.md)**: Authoritative Next.js API route endpoints, guards, read/writes, and fail-closed behaviors.
- **[`TEST_MAP.md`](TEST_MAP.md)**: Mapping of specification requirements to Vitest, Pytest, and Playwright tests.
- **[`EXTERNAL_DEPENDENCIES.md`](EXTERNAL_DEPENDENCIES.md)**: Production prerequisites (Razorpay, AAL2/MFA, external meter telemetry, specialist reviews).
- **[`repository-graph.json`](repository-graph.json)**: Machine-readable dependency graph linking UI pages, API routes, tables, RPCs, and tests.
- **[`modules/`](modules/)**: Compact per-module context briefs:
  - [`GRID.md`](modules/GRID.md) — Grid Intelligence Monitor (96-block day-ahead forecast, Cost Explorer).
  - [`DSM.md`](modules/DSM.md) — DSM Risk Monitor (15-minute deviation, risk bands, atomic incidents).
  - [`BESS.md`](modules/BESS.md) — BESS Arbitrage Signals (advisory charge/discharge, safety interlocks).
  - [`COMPLIANCE.md`](modules/COMPLIANCE.md) — Open Access Compliance Sentinel (regulatory register, voltage matching).
  - [`RENEWABLES.md`](modules/RENEWABLES.md) — Renewable Portfolio Monitor (generation tracking, CEA emission factor).
  - [`INGESTION.md`](modules/INGESTION.md) — CSV Ingestion Gateway (96-block validator, SHA-256 idempotency, atomic commit RPC).
  - [`BILLING.md`](modules/BILLING.md) — Product Catalogue & Razorpay Billing (checkout sessions, idempotent webhooks).
  - [`REPORTS.md`](modules/REPORTS.md) — Report Generation & Download Gateway (`report_records`, storage paths).
  - [`ALERTS.md`](modules/ALERTS.md) — Alert & Notification Hub (deduplication, atomic acknowledgment RPC).
  - [`AUTH.md`](modules/AUTH.md) — Authentication, RBAC, Onboarding, and Site Access.
  - [`ADMIN.md`](modules/ADMIN.md) — Internal Platform Operations & Regulatory Review.
