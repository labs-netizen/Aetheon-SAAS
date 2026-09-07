# MODULE: Common Report System

- **Status**: `VERIFIED_IMPLEMENTED` (Unified Reporting Gateway).
- **Authoritative UI**: `src/app/reports/page.tsx`
- **Authoritative API**: `src/app/api/reports/route.ts`, `src/app/api/reports/generate/route.ts`, `src/app/api/reports/[id]/download/route.ts`.
- **Auth/Entitlement**: Report generation requires `ENERGY_MANAGER` or `ORGANISATION_ADMIN`. Download requires site access and module entitlement.
- **Reads**: `report_records`, underlying operational runs (`grid_forecast_runs`, `bess_signal_runs`, `dsm_incidents`).
- **Writes**: `report_records` (unified schema: `storage_path`, `summary`, `quality_status`, `model_version`, `generated_by`, `download_url`).
- **RPCs**: `has_site_access`.
- **External Service**: Supabase Storage private bucket `tenant-reports`.
- **Quality Gate**: Gated by quality status of underlying operational data. Uncalibrated data yields `DATA_GAP`.
- **Fail-Closed Conditions**: If underlying runs are absent, aborts generation without data fabrication. Download route returns 403 on missing entitlement or site access, and returns 404 `REPORT_FILE_UNAVAILABLE` on missing storage objects.
- **Provenance**: Records model version, tariff version, quality status, and generation timestamp in `report_records` and CSV headers.
- **Reports**: Grid Forecast, DSM Incidents, BESS Arbitrage, Compliance Dossier, and Renewable Generation.
- **Alerts**: Dispatches `REPORT_GENERATION_FAILED` on storage upload error.
- **Demo Behavior**: Interactive report viewer and simulated export initiation.
- **Live Behavior**: Generates real CSV file, uploads to private storage, and issues signed download URLs.
- **Tests**: `tests/integration/adversarial_api.test.ts` (Test 20, 32), `tests/e2e/persistence_journey.spec.ts`, `tests/e2e/demo_smoke.spec.ts` (Test 7).
- **External Requirements**: Durable cloud object storage bucket provisioning.
- **Known Limitations**: PDF rendering engine is optional in V1; CSV export is authoritative and universal.
