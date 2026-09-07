# MODULE: BESS Arbitrage Signals

- **Status**: `SPECIALIST_REVIEW_REQUIRED` (Pricing: ₹49,900/site/month).
- **Authoritative UI**: `src/app/bess/page.tsx`
- **Authoritative API**: `src/app/api/bess/route.ts`
- **Auth/Entitlement**: Requires valid session, `has_site_access(siteId)`, and `BESS_ARBITRAGE` entitlement.
- **Reads**: `bess_assets` (capacity_kwh, max_c_rate, charge_efficiency, degradation_cost_per_cycle_inr), day-ahead discom tariffs.
- **Writes**: `bess_signal_runs` (service-role write).
- **RPCs**: `has_site_access` (authorization check).
- **External Service**: Python FastAPI microservice (`POST /bess/optimize`).
- **Quality Gate**: Demands valid physical battery parameters and non-stale telemetry ($< 15$ minutes).
- **Fail-Closed Conditions**: Backend returns `is_suppressed: true` with `suppression_reason: 'SAFETY_INTERLOCK'` if battery SOC $< 10\%$ or $> 90\%$, if maintenance lock is set, or if telemetry is stale.
- **Provenance**: Displays cell chemistry, cycle count, degradation cost rate, and optimization solver version.
- **Reports**: `BESS_ARBITRAGE_REPORT` (CSV export of recommended 96-block power schedule and net daily arbitrage profit).
- **Alerts**: Dispatches `BESS_SAFETY_LOCKOUT` if thermal threshold or critical SOC boundaries are breached.
- **Demo Behavior**: Allows simulated SOC slider inputs; clearly watermarked with `DEMO DATA / UNVERIFIED`.
- **Live Behavior**: Strictly server-authoritative; queries configured `bess_assets` and rejects fabricated client SOC.
- **Tests**: `services/analytics/tests/test_analytics.py` (`test_bess_advisory_physical_feasibility`), `tests/integration/adversarial_api.test.ts` (Test 7), `tests/e2e/demo_smoke.spec.ts` (Test 11).
- **External Requirements**: Electrochemical engineer signoff on battery degradation cost curve (₹/cycle) and live BMS Modbus connector.
- **Known Limitations**: Outputs are strictly advisory operating recommendations; no direct SCADA inverter actuation in V1.
