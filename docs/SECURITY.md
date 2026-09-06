# Aetheon Energy Intelligence Platform - Security & Governance Architecture (SECURITY.md)

## 1. Security Overview

The **Aetheon Energy Intelligence Platform** processes sensitive C&I operational data, interval meter telemetry, procurement pricing, and plant configurations. This document outlines the security architecture, controls implemented, known limitations, and procedures awaiting specialist audit.

> [!CAUTION]
> This platform has not yet undergone an independent third-party penetration test. All security controls documented herein represent first-pass production-oriented engineering and must undergo the specialist audit outlined in `docs/HANDOFF_TO_ASTRA.md` prior to commercial paid launch.

---

## 2. Implemented Protections

### 2.1 Multi-Tenant Isolation
- **Row Level Security (RLS)**: Enforced directly at the PostgreSQL layer. All tenant tables (`sites`, `interval_data_96`, `subscriptions`, `alerts`, `audit_logs`) contain an `organisation_id` foreign key.
- **Session Scoping**: Authenticated queries resolve tenant membership via the `memberships` table. Direct cross-tenant querying is prevented at the database kernel level.
- **Private Storage**: All Supabase Storage buckets for CSV uploads and report PDFs are configured as private with signed URLs for authorized users only.

### 2.2 Role-Based Access Control (RBAC)
- 6 distinct roles enforced across both UI routing and API endpoints:
  - `ORGANISATION_ADMIN`: Organization, billing, user, and site administration.
  - `ENERGY_MANAGER`: Operational dashboards, data upload, asset configuration.
  - `OPERATOR`: Alerts view and incident acknowledgment. Zero billing access.
  - `FINANCE_SUSTAINABILITY_VIEWER`: Read-only financial and sustainability reports.
  - `AETHEON_ANALYST`: Internal support role with mandatory time-expiry (`expires_at`) and mandatory audit logging of every query.
  - `AETHEON_REGULATORY_REVIEWER`: Internal regulatory publishing role. Completely isolated from customer billing permissions.

### 2.3 Secret Management & Frontend Boundary
- Frontend code utilizes only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Supabase `SERVICE_ROLE_KEY`, Razorpay webhook secrets, and analytics service tokens are restricted strictly to server-side Next.js route handlers.

### 2.4 Idempotency & Webhook Verification
- Razorpay webhooks require cryptographic HMAC-SHA256 signature verification before updating subscription state.
- Ingestion runs compute SHA-256 file hashes to prevent double-counting of interval loads.

---

## 3. Governance, Auditability & Incident Response

### 3.1 Audit Logging
- Every tenant creation, user invitation, role modification, subscription state change, file ingestion, regulatory approval, and alert acknowledgment writes an immutable row to `audit_logs`.
- Audit records store actor ID, role, action, entity, timestamp, IP address, and JSON diffs.
- Retention target: 7 years for compliance and statutory auditability.

### 3.2 Regulatory Publication Quality Gate
- Untrusted web-scraped or AI-extracted regulatory parameters are locked in `REVIEW_PENDING`.
- No user-facing calculation may consume rules from `REVIEW_PENDING` without an `AETHEON_REGULATORY_REVIEWER` electronic sign-off.
- Synthetic demo parameters are explicitly stamped `DEMO / UNVERIFIED`.

### 3.3 Aetheon Admin Security Requirements
- Multi-Factor Authentication (MFA) is strictly required for internal Aetheon platform administrators.
- Analyst access sessions expire automatically after a maximum of 24 hours.

### 3.4 Operational Failure & Data Retention
- Incident Response: Telemetry failure triggers an automatic transition of site monitoring to `DEGRADED`.
- Advisory Suppression: When data freshness is lost, recommendations are hard-suppressed to prevent erroneous operational actions.
- Data export: Full self-service CSV/JSON data export is provided to all customers for data portability.
