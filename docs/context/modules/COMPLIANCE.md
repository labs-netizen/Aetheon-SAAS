# MODULE: Open Access Compliance Sentinel

- **Status**: `SPECIALIST_REVIEW_REQUIRED` (Pricing: ₹14,900/state/site/month).
- **Authoritative UI**: `src/app/compliance/page.tsx`
- **Authoritative API**: `src/app/api/compliance/route.ts`
- **Auth/Entitlement**: Requires valid session, site scope, and `OA_COMPLIANCE` entitlement.
- **Reads**: `regulatory_sources`, `compliance_obligations`, `discom_tariffs`.
- **Writes**: None from customer API (read-only portal).
- **RPCs**: `has_site_access`.
- **External Service**: None (pure relational rules engine).
- **Quality Gate**: Regulatory resolver strictly requires approval status (`APPROVED` or `PUBLISHED`) and exact voltage level match.
- **Fail-Closed Conditions**: Unapproved tariff orders (`REVIEW_PENDING`, `DRAFT`, `EXTRACTED`) are strictly filtered from customer view. Missing voltage-matched tariff returns `DATA GAP`.
- **Provenance**: Displays regulatory authority (e.g. MERC, GERC), order number, publication date, and non-legal advice disclaimer.
- **Reports**: `COMPLIANCE_AUDIT_DOSSIER` (regulatory obligations, filing deadlines, and approved surcharges).
- **Alerts**: Dispatches `COMPLIANCE_DEADLINE_WARNING` 7 days and 24 hours prior to statutory OA filing dates.
- **Demo Behavior**: Interactive view of Maharashtra and Gujarat open access tariffs and sample filing schedule.
- **Live Behavior**: Strictly bound to active site state, DISCOM, voltage class, and dynamic `compliance_obligations`.
- **Tests**: `tests/unit/tariffs.test.ts`, `tests/integration/adversarial_api.test.ts` (Test 18, 33), `tests/e2e/demo_smoke.spec.ts` (Test 10).
- **External Requirements**: Legal & regulatory specialist review of state-specific Open Access surcharge algorithms.
- **Known Limitations**: Information provided is regulatory decision support, not certified legal counsel.
