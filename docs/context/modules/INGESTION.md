# MODULE: Data Gateway & CSV Ingestion

- **Status**: `VERIFIED_IMPLEMENTED` (Core Platform Gateway).
- **Authoritative UI**: `src/app/settings/page.tsx` (Data Ingestion tab).
- **Authoritative API**: `src/app/api/ingestion/commit/route.ts`
- **Auth/Entitlement**: Requires `ENERGY_MANAGER` or `ORGANISATION_ADMIN` role and `has_site_access(siteId)`.
- **Reads**: Multipart raw CSV stream.
- **Writes**: `ingestion_runs`, `interval_data_96`, `sites`, `site_activation_history`, `audit_logs`.
- **RPCs**: `commit_ingestion_transaction` (canonical 8-arg signature: `site_id`, `filename`, `checksum_sha256`, `uploaded_by`, `rows`, `freshness_status`, `actor_role`, `org_id`).
- **External Service**: None (PostgreSQL transactional RPC).
- **Quality Gate**: Validates exactly 96 contiguously indexed 15-minute intervals per operating date. Completeness $< 95\%$ or stale data marks run `BLOCKED_INCOMPLETE` / `BLOCKED_STALE`.
- **Fail-Closed Conditions**: Computes SHA-256 server-side on raw stream; returns HTTP 409 `DUPLICATE_FILE` on duplicate hash. Returns HTTP 400 on malformed columns or non-numeric load values. Client-controlled JSON bypass has been removed.
- **Provenance**: Records original filename, SHA-256 hash, uploaded_by UUID, row count, and activation transition in `audit_logs`.
- **Reports**: Ingestion run summary with validation metrics.
- **Alerts**: Dispatches `INGESTION_FAILURE` on parse or contiguity failure.
- **Demo Behavior**: Provides deterministic 96-block sample CSV template download.
- **Live Behavior**: Persists 96 intervals per date into `interval_data_96`; transitions site status (`CALIBRATING` $\to$ `ACTIVE` upon accumulating 7 days of contiguous data).
- **Tests**: `tests/unit/csvParser.test.ts`, `tests/integration/adversarial_api.test.ts` (Test 8, 9), `tests/e2e/persistence_journey.spec.ts`, `tests/e2e/demo_smoke.spec.ts` (Test 5).
- **External Requirements**: Live AMR meter SFTP/API connectors when available.
- **Known Limitations**: V1 supports 96-block CSV files only; Excel (.xlsx) support intentionally removed for security and schema rigor.
