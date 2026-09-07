# Aetheon Energy Intelligence Platform - Security & Governance Architecture (SECURITY.md)

## 1. Security Overview

The **Aetheon Energy Intelligence Platform** processes sensitive C&I operational data, interval meter telemetry, procurement pricing, and plant configurations. This document outlines the security architecture, controls implemented, known limitations, and procedures awaiting specialist audit.

> [!CAUTION]
> This platform has not yet undergone an independent third-party penetration test. All security controls documented herein represent first-pass production-oriented engineering and must undergo the specialist audit outlined in `docs/HANDOFF_TO_ASTRA.md` prior to commercial paid launch.

---

## 2. Automated Security & Isolation Test Suite

A comprehensive 10-point automated security test suite has been implemented in `tests/integration/security_isolation.test.ts` (10/10 passing in Vitest):

1. **Organisation Data Isolation**: Verifies that user sessions tied to Organisation A cannot read or access records belonging to Organisation B.
2. **Organisation Mutation Isolation**: Verifies that mutations initiated under Organisation A context cannot create, update, or delete records in Organisation B.
3. **Site Boundary Isolation**: Verifies that users assigned to a specific site cannot retrieve telemetry or assets from other sites.
4. **Role Escalation Prevention**: Verifies that low-privilege roles (e.g. `FINANCE_SUSTAINABILITY_VIEWER` or `OPERATOR`) cannot perform administrative actions (inviting users, updating billing, modifying tariff rules).
5. **Administrative Access Boundary**: Verifies that customer roles (including customer `ORGANISATION_ADMIN`) cannot access internal Aetheon administration endpoints or routes (`/admin`).
6. **Entitlement Protection & Bypass Prevention**: Verifies that accounts without an active subscription for a specific module (e.g. `OA_COMPLIANCE`) are strictly blocked at the entitlement check layer.
7. **Regulatory Review & Publication Boundary**: Verifies that regulatory rules in `CHANGE_DETECTED/REVIEW_PENDING` status cannot be retrieved by customer sessions until officially reviewed and moved to `APPROVED/PUBLISHED`.
8. **Ingestion SHA-256 Deduplication**: Verifies that duplicate or replayed CSV telemetry uploads with matching content hashes are rejected with an idempotency collision error.
9. **Payment Webhook HMAC & Replay Protection**: Verifies that tampered HMAC signatures and replayed `x-razorpay-event-id` headers are rejected with 401/409 responses.
10. **Private Storage Bucket Partitioning**: Verifies that tenant document storage paths (`tenants/{orgId}/`) enforce strict path validation and reject cross-tenant path traversal.

---

## 3. Implemented Protections

### 3.1 Multi-Tenant Isolation
- **Row Level Security (RLS)**: Enforced directly at the PostgreSQL layer. All tenant tables (`sites`, `interval_data_96`, `subscriptions`, `alerts`, `audit_logs`) contain an `organisation_id` foreign key.
- **Session Scoping**: Authenticated queries resolve tenant membership via the `memberships` table. Direct cross-tenant querying is prevented at the database kernel level.
- **Private Storage**: All Supabase Storage buckets for CSV uploads and report PDFs are configured as private with signed URLs for authorized users only.

### 3.2 Role-Based Access Control (RBAC)
- 6 distinct roles enforced across both UI routing and API endpoints:
  - `ORGANISATION_ADMIN`: Organization, billing, user, and site administration.
  - `ENERGY_MANAGER`: Operational dashboards, data upload, asset configuration.
  - `OPERATOR`: Alerts view and incident acknowledgment. Zero billing access.
  - `FINANCE_SUSTAINABILITY_VIEWER`: Read-only financial and sustainability reports.
  - `AETHEON_ANALYST`: Internal support role with mandatory time-expiry (`expires_at`) and mandatory audit logging of every query.
  - `AETHEON_REGULATORY_REVIEWER`: Internal regulatory publishing role. Completely isolated from customer billing permissions.
- **Client Role Switcher Isolation**: Gated behind `NEXT_PUBLIC_DEMO_MODE !== 'false'`. In production mode, role switching in client UI is disabled and role identity is strictly derived from verified Supabase session claims.

### 3.3 Secret Management & Frontend Boundary
- Frontend code utilizes only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Supabase `SERVICE_ROLE_KEY`, Razorpay webhook secrets, and analytics service tokens are restricted strictly to server-side Next.js route handlers.

### 3.4 Idempotency & Webhook Verification
- Razorpay webhooks require cryptographic HMAC-SHA256 signature verification before updating subscription state.
- Ingestion runs compute SHA-256 file hashes to prevent double-counting of interval loads.

---

## 4. Governance, Auditability & Incident Response

### 4.1 Audit Logging
- Every tenant creation, user invitation, role modification, subscription state change, file ingestion, regulatory approval, and alert acknowledgment writes an immutable row to `audit_logs`.
- Audit records store actor ID, role, action, entity, timestamp, IP address, and JSON diffs.
- Retention target: 7 years for compliance and statutory auditability.

### 4.2 Regulatory Publication Quality Gate
- Untrusted web-scraped or AI-extracted regulatory parameters are locked in `REVIEW_PENDING`.
- No user-facing calculation may consume rules from `REVIEW_PENDING` without an `AETHEON_REGULATORY_REVIEWER` electronic sign-off.
- Synthetic demo parameters are explicitly stamped `DEMO / UNVERIFIED`.

### 4.3 Aetheon Admin Security Requirements
- Multi-Factor Authentication (MFA) is strictly required for internal Aetheon platform administrators.
- Analyst access sessions expire automatically after a maximum of 24 hours.

### 4.4 Operational Failure & Data Retention
- Incident Response: Telemetry failure triggers an automatic transition of site monitoring to `DEGRADED`.
- Advisory Suppression: When data freshness is lost, recommendations are hard-suppressed to prevent erroneous operational actions.
- Data export: Full self-service CSV/JSON data export is provided to all customers for data portability.
