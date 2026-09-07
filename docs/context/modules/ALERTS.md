# MODULE: Alert & Notification Hub

- **Status**: `VERIFIED_IMPLEMENTED` (Platform Alert Engine).
- **Authoritative UI**: `src/app/alerts/page.tsx`
- **Authoritative API**: `src/app/api/alerts/route.ts`, `src/app/api/alerts/[id]/acknowledge/route.ts`.
- **Auth/Entitlement**: Viewing requires site access. Acknowledgment requires `OPERATOR`, `ENERGY_MANAGER`, or `ORGANISATION_ADMIN`.
- **Reads**: `alerts`, `notification_logs`.
- **Writes**: `alerts`, `audit_logs`, `notification_logs`.
- **RPCs**: `acknowledge_alert_atomic(alert_id, user_id, user_role, org_id)` (atomic update + audit log).
- **External Service**: Local Mailpit / Inbucket (`:15434`) for transactional lifecycle emails.
- **Quality Gate**: Alert deduplication cooldown prevents notification storms (1 alert per condition per cooldown window).
- **Fail-Closed Conditions**: Acknowledgment fails safely; UI state updates only after server returns HTTP 200. Notification log privacy RLS prevents non-admin users from reading other users' alerts.
- **Provenance**: Records trigger condition, severity, acknowledging user, and acknowledgment timestamp in `audit_logs`.
- **Reports**: Alert incident history included in site audit records.
- **Alerts**: 6 canonical types: `PEAK_DEMAND_WARNING`, `DSM_HIGH_RISK_DEVIATION`, `BESS_SAFETY_LOCKOUT`, `COMPLIANCE_DEADLINE_WARNING`, `RENEWABLE_UNDERPERFORMANCE`, `DATA_PIPELINE_STALE`.
- **Demo Behavior**: Interactive alerts feed with simulated acknowledgment.
- **Live Behavior**: Real database mutations in `alerts` and atomic `ALERT_ACKNOWLEDGED` entries in `audit_logs`.
- **Tests**: `tests/integration/adversarial_api.test.ts` (Test 20), `tests/e2e/demo_smoke.spec.ts` (Test 8), `tests/e2e/persistence_journey.spec.ts`.
- **External Requirements**: Production transactional email provider (SendGrid, AWS SES, or Resend).
- **Known Limitations**: Push notifications / SMS gateways require carrier DLT registration in India.
