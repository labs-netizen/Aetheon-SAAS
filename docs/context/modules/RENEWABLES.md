# MODULE: Renewable Portfolio Monitor

- **Status**: `DEMO_ONLY` (Pricing: ₹24,900/site/month).
- **Authoritative UI**: `src/app/renewables/page.tsx`
- **Authoritative API**: `src/app/api/renewables/route.ts`
- **Auth/Entitlement**: Requires valid session, `has_site_access(siteId)`, and `RENEWABLE_PORTFOLIO` entitlement.
- **Reads**: `renewable_assets`, 96-block solar generation from `interval_data_96`, `emission_factors` (CEA v19).
- **Writes**: None from customer API.
- **RPCs**: `has_site_access`.
- **External Service**: Python FastAPI microservice (`POST /analytics/renewables/reconcile`).
- **Quality Gate**: Demands 96-block measured interval generation; rejects scalar solar synthesis.
- **Fail-Closed Conditions**: Returns `DATA GAP` if measured solar interval telemetry is absent. Avoided emissions calculations are suppressed on missing factors.
- **Provenance**: Displays official Central Electricity Authority (CEA) Baseline Database for Indian Power Sector Version 19 factor (0.716 tCO₂e/MWh) with carbon credit disclaimer.
- **Reports**: `RENEWABLE_GENERATION_LEDGER` (measured vs modelled generation, performance ratio, and avoided emissions).
- **Alerts**: Manual alert view verified local. Automated dispatch is `NOT_IMPLEMENTED` in V1.
- **Demo Behavior**: Renders synthetic solar curve clearly marked `DEMO DATA / UNVERIFIED`.
- **Live Behavior**: Strictly derived from 96-block meter generation telemetry in `interval_data_96`.
- **Tests**: `services/analytics/tests/test_analytics.py` (`test_renewable_reconciliation`), `tests/integration/adversarial_api.test.ts` (Test 17).
- **External Requirements**: Live on-site Modbus inverter gateway connection and annual CEA factor updates.
- **Known Limitations**: Avoided emissions cannot be claimed as tradeable carbon credits without accredited registry validation.
