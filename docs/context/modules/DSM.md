# MODULE: DSM Risk Monitor

- **Status**: `INTERNAL_VALIDATION` (Pricing: ₹29,900/site/month).
- **Authoritative UI**: `src/app/dsm/page.tsx`
- **Authoritative API**: `src/app/api/dsm/route.ts`
- **Auth/Entitlement**: Requires valid session, `has_site_access(siteId)`, and `DSM_RISK` entitlement.
- **Reads**: `interval_data_96` (scheduled vs actual drawal), `sites.contract_demand_value`.
- **Writes**: `dsm_incidents` (service-role write with unique window index `idx_dsm_incidents_unique_window`).
- **RPCs**: `acknowledge_dsm_incident_atomic(incident_id, site_id, user_id, role, org_id)` (atomic update + audit log).
- **External Service**: Python FastAPI microservice (`POST /dsm`).
- **Quality Gate**: Demands 96 valid numeric interval blocks. Missing or null values trigger `BLOCKED_MISSING_INPUT`.
- **Fail-Closed Conditions**: If scheduled or actual drawal contains missing/null/non-finite values, returns HTTP 200 with `is_suppressed: true`, `suppression_reason: 'MISSING_DATA'`, and zeroed penalty INR.
- **Provenance**: Displays CERC/SERC DSM 2nd Amendment regulatory reference.
- **Reports**: `DSM_INCIDENT_SUMMARY` (CSV export of incident windows, excess kWh, and estimated exposure).
- **Alerts**: Dispatches `DSM_HIGH_RISK_DEVIATION` when deviation exceeds 12% in continuous process operations. Respects quiet hours (22:00–06:00 IST).
- **Demo Behavior**: Interactive 96-block sliders and simulation controls; incident acknowledgment mutates local state only after HTTP 200.
- **Live Behavior**: Strictly loads persisted 96-block schedules and actual AMR meter draws from `interval_data_96`.
- **Tests**: `services/analytics/tests/test_analytics.py` (`test_dsm_deviation_calculation`), `tests/integration/adversarial_api.test.ts` (Test 6, 29, 30), `tests/e2e/demo_smoke.spec.ts` (Test 12).
- **External Requirements**: Live SLDC frequency feed and state-specific deviation pricing multiplier tables.
- **Known Limitations**: Penalty calculations are advisory estimates based on published grid frequency bands.
