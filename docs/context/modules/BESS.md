# MODULE: BESS Arbitrage Signals

- **Status**: `SPECIALIST_REVIEW_REQUIRED` (Pricing: ₹49,900/site/month).
- **Authoritative UI**: `src/app/bess/page.tsx`
- **Authoritative API**: `src/app/api/bess/route.ts`
- **Auth/Entitlement**: Requires valid session, `has_site_access(siteId)`, and `BESS_ARBITRAGE` entitlement.
- **Reads**: `bess_assets` (`usable_capacity_kwh`, `power_rating_kw`, `charge_efficiency`, `discharge_efficiency`, `min_soc_pct`, `max_soc_pct`, `current_soc_pct`, `degradation_cost_per_cycle_inr`, `maintenance_lock`, `is_active`, `last_telemetry_at`), `interval_data_96` (for latest telemetry / initial SOC), `grid_forecast_blocks` (for authoritative 96-block day-ahead tariff curve).
- **Writes**: `bess_signal_runs` (service-role write with solver inputs, recommended 96-block charge/discharge schedule, and net arbitrage economics).
- **RPCs**: `has_site_access` (authorization check).
- **External Service**: Python FastAPI microservice (`POST /v1/bess/optimise-demo`).
- **Quality Gate**: Requires active `bess_assets` record, valid non-stale interval telemetry, and published 96-block price curve. Rejects client-fabricated prices or missing price curve.
- **Fail-Closed Conditions**: Returns 422 or suppression with `is_suppressed: true` and `suppression_reason: 'CONFIGURATION_REQUIRED'` if no active BESS asset is configured, or `'DATA_GAP'` if telemetry/price curve is absent, or `SAFETY_INTERLOCK` if initial SOC is out of bounds (< min_soc_pct or > max_soc_pct).
- **Provenance**: Records `solver_version: 'BESS_ARBITRAGE_INTERNAL_VALIDATION_v1.0'` (live) or heuristic demo version, battery asset constraints (`usable_capacity_kwh`, `power_rating_kw`), and optimization objective.
- **Reports**: `BESS_PERFORMANCE_REPORT` (Generated via `POST /api/reports/generate` from persisted `bess_signal_runs` and `bess_assets` schema).
- **Alerts**: Manual acknowledgement/retrieval verified local (`alerts` table); automated `BESS_SAFETY_LOCKOUT` dispatch is `NOT_IMPLEMENTED` in V1.
- **Demo Behavior**: Interactive simulation mode with client sliders for initial SOC and test price curves, clearly badged `DEMO DATA / UNVERIFIED`.
- **Live Behavior**: Strictly server-authoritative; pulls persisted `bess_assets`, reads telemetry from `interval_data_96`, fetches forecast prices from `grid_forecast_blocks`, persists to `bess_signal_runs`.
- **Tests**: `tests/integration/adversarial_api.test.ts` (Test 7: negative SOC validation; Test 22: live BESS solver execution, run persistence, and `BESS_PERFORMANCE_REPORT` generation), `services/analytics/tests/test_analytics.py` (`test_bess_advisory_physical_feasibility`), `tests/e2e/demo_smoke.spec.ts` (Test 11), `tests/e2e/real_auth_workflows.spec.ts` (Test 8).
- **External Requirements**: Specialist electrochemical signoff on degradation modeling and hardware BMS telemetry integration.
- **Known Limitations**: Recommendations are purely advisory operational signals; no automated direct SCADA inverter actuation.
