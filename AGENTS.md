# AGENTS.md — Future Agent Entry Point

Welcome, AI Agent. This repository contains the **Aetheon Energy Intelligence Platform** (SaaS V1 for Indian Commercial & Industrial electricity consumers).

Before performing broad repository exploration, follow these navigation rules to preserve your context window:

## 1. Navigation Protocol
1. **Read this file (`AGENTS.md`) first.**
2. **Read [`docs/PRODUCT_SPECIFICATION.md`](docs/PRODUCT_SPECIFICATION.md)** only when functional/domain product requirements are needed.
3. **Read [`docs/context/CURRENT_STATE.md`](docs/context/CURRENT_STATE.md)** to inspect verified commit, test, build, migration, and operational status.
4. **Read [`docs/context/CODEBASE_MAP.md`](docs/context/CODEBASE_MAP.md)** to locate architectural layers and directory structure.
5. **Read only the relevant module file(s)** under [`docs/context/modules/`](docs/context/modules/) (`GRID.md`, `DSM.md`, `BESS.md`, `COMPLIANCE.md`, `RENEWABLES.md`, `INGESTION.md`, `BILLING.md`, `REPORTS.md`, `ALERTS.md`, `AUTH.md`, `ADMIN.md`).
6. **Use specialized index maps** (`DATABASE_MAP.md`, `SECURITY_MAP.md`, `API_MAP.md`, `TEST_MAP.md`, `EXTERNAL_DEPENDENCIES.md`) only when addressing those specific cross-cutting concerns.
7. **Always verify critical facts against actual source files** before applying edits.
8. **Do NOT recursively re-read the entire repository** unless the context index is demonstrably stale.
9. **Treat context documentation as a navigation cache**, NOT the ultimate source of truth.
10. **When modifying a mapped relationship or API**, update the corresponding context file in the same commit.

## 2. Hierarchy of Authority
When resolving conflicts, strictly observe this order of authority:
1. **[`docs/PRODUCT_SPECIFICATION.md`](docs/PRODUCT_SPECIFICATION.md)** — Definitive domain & product requirements.
2. **Final Supabase Migrations (`supabase/migrations/`)** — Definitive database schema and RLS truth.
3. **Executable Application & Service Source Code (`src/`, `services/analytics/`)** — Implementation truth.
4. **Executable Automated Test Suites (`tests/`, `services/analytics/tests/`)** — Verified behavioral evidence.
5. **Context Navigation Layer (`docs/context/*`)** — Navigation and indexing cache.
6. **Descriptive Handoff Documents (`docs/HANDOFF_TO_ASTRA.md`, etc.)** — Historical and descriptive documentation.
