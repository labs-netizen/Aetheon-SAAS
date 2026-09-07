# MODULE: Grid Intelligence Monitor

- **Status**: `INTERNAL_VALIDATION` (Pricing: ₹19,900/site/month).
- **Authoritative UI**: `src/app/grid-intelligence/page.tsx`
- **Authoritative API**: `src/app/api/forecast/route.ts`
- **Auth/Entitlement**: Requires valid session, `has_site_access(siteId)`, and `GRID_INTELLIGENCE` product entitlement.
- **Reads**: `sites`, `interval_data_96` (96-block meter load), `discom_tariffs`.
- **Writes**: `grid_forecast_runs`, `grid_forecast_blocks` (canonical FK: `run_id`). Client writes blocked by RLS.
- **RPCs**: `has_site_access` (authorization check).
- **External Service**: Python FastAPI microservice (`POST /forecast` on port 8000).
- **Quality Gate**: Evaluates `QualityGate.evaluateTelemetry()` on interval data. Requires $\ge 95\%$ completeness and freshness $< 24$ hours for `PUBLISHABLE`.
- **Fail-Closed Conditions**: If site status is not `ACTIVE` (e.g. `AWAITING_DATA` or uncalibrated), returns `DATA GAP` / `BLOCKED_MISSING_INPUT` with zeroed avoided cost. Never fabricates `Math.sin()` curves in live mode.
- **Provenance**: Displays active model version, discom tariff order reference, and execution timestamp in `ProvenanceFooter`.
- **Reports**: `GRID_FORECAST_REPORT` (96-block CSV export via `/api/reports/generate`).
- **Alerts**: Dispatches `PEAK_DEMAND_WARNING` when predicted demand exceeds 90% sanctioned contract demand.
- **Demo Behavior**: Loads deterministic 96-block Maharashtra profile flagged with `DEMO DATA / UNVERIFIED`.
- **Live Behavior**: Strictly derived from persisted 15-minute AMR meter telemetry in `interval_data_96`.
- **Tests**: `services/analytics/tests/test_analytics.py` (`test_grid_forecast_96_blocks`), `tests/integration/adversarial_api.test.ts` (Test 1, 20, 34), `tests/e2e/demo_smoke.spec.ts` (Test 3, 4).
- **External Requirements**: Live IEX DAM price clearing feed connector and state-specific weather forecasting calibration.
- **Known Limitations**: Day-ahead forecast uses baseline model until 30 days of AMR load history are accumulated.
