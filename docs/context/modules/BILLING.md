# MODULE: Product Catalogue & Razorpay Billing

- **Status**: `PRODUCTION_CONFIG_REQUIRED` (Logic Verified Locally).
- **Authoritative UI**: `src/app/settings/page.tsx` (Billing & Plan Selection).
- **Authoritative API**: `src/app/api/billing/checkout/route.ts`, `src/app/api/billing/cancel/route.ts`, `src/app/api/webhooks/razorpay/route.ts`.
- **Auth/Entitlement**: Checkout & Cancel require `ORGANISATION_ADMIN` role. Webhook is unauthenticated and verified via HMAC-SHA256.
- **Reads**: `products`, `subscriptions`, `subscription_items`, `billing_checkout_sessions`.
- **Writes**: `subscriptions`, `subscription_items`, `invoices`, `billing_checkout_sessions`, `audit_logs`.
- **RPCs**: `has_org_role` for checkout access control.
- **External Service**: Razorpay payment gateway API (segregated modes: `MOCK_DEVELOPMENT`, `RAZORPAY_TEST`, `RAZORPAY_LIVE`).
- **Quality Gate**: Commercial price integrity: all amounts stored as integer paise (₹19,900 = 1,990,000 paise).
- **Fail-Closed Conditions**: Checkout requires existing organisation binding. Webhook rejects invalid HMAC signatures (400) and quarantines unmapped provider reference notes without granting entitlements.
- **Provenance**: Records billing transaction IDs, invoice references, and role-authorized cancellations in `audit_logs`.
- **Reports**: Tax invoice downloads.
- **Alerts**: Dispatches `SUBSCRIPTION_PAYMENT_FAILED` on failed recurring charges.
- **Demo Behavior**: Full plan builder with simulated checkout in `MOCK_DEVELOPMENT` mode.
- **Live Behavior**: Unique index `idx_subscription_items_unique` on `(subscription_id, product_id, site_id)` prevents duplicate entitlement rows. Supports `FAILED` status in invoices and checkout sessions.
- **Tests**: `tests/unit/currency.test.ts`, `tests/unit/entitlements.test.ts`, `tests/integration/adversarial_api.test.ts` (Test 9, 10, 16), `tests/integration/security_isolation.test.ts`.
- **External Requirements**: Live Razorpay merchant KYC, live API keys, and production webhook secret in vault.
- **Known Limitations**: Offline bank transfers (NEFT/RTGS) require manual administrative provisioning.
