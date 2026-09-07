# DATABASE_MAP.md — Database Schema, Migrations & RPC Reference

This map documents the PostgreSQL 17.6 database schema, migration lineage, table purposes, and Security Definer RPCs.

## 1. Migration Chain (13 Applied Migrations)

1. `20260907000001_core_tenancy.sql`: Organisations, user profiles, memberships, sites, site access.
2. `20260907000002_catalog_subscriptions.sql`: Products, subscriptions, subscription items, invoices.
3. `20260907000003_data_gateway_quality.sql`: Data sources, ingestion runs, interval_data_96, quality evaluations.
4. `20260907000004_regulatory_framework.sql`: Regulatory sources, discom tariffs, open access rules.
5. `20260907000005_modules_data.sql`: Grid forecast, DSM incidents, BESS assets/runs, renewable assets.
6. `20260907000006_alerts_reports_notifications.sql`: Alerts, notifications, notification logs, report records, audit logs.
7. `20260907000007_rls_policies.sql`: Initial Row-Level Security policies across all public tables.
8. `20260907000008_security_site_access_hardening.sql`: `has_site_access()` RPC, site-level RLS boundaries.
9. `20260907000009_final_astra_hardening.sql`: Privilege escalation triggers, customer role boundary locks.
10. `20260907000010_pre_astra_hardening.sql`: Security definer RPC lockdowns, write-time analyst expiry trigger.
11. `20260907000011_pre_astra_blockers.sql`: Advisory lock on audit chaining, dynamic compliance obligations.
12. `20260907000012_final_rls_and_pipeline_consistency.sql`: Canonical 8-arg ingestion RPC, legacy RLS purge, CEA emission factor seed, FAILED billing status, unique indexes.
13. `20260907000013_atomic_acknowledgement_audit.sql`: Atomic alert & DSM incident acknowledgment RPCs with transactional audit logging.

## 2. Table Catalog

| Table Name | Primary Key | Key Foreign Keys | Purpose & Security Constraint |
|---|---|---|---|
| `organisations` | `id` (UUID) | None | Tenant accounts. RLS: Org members view; Org Admins manage. |
| `user_profiles` | `id` (UUID) | `auth.users(id)` | User metadata. RLS: Org scope view. `is_platform_admin` protected by trigger. |
| `memberships` | `id` (UUID) | `organisation_id`, `user_id` | User role mapping. Internal roles (`AETHEON_*`) protected from customer admin assignment. |
| `sites` | `id` (UUID) | `organisation_id` | Physical C&I facilities. RLS: filtered by `has_site_access()`. |
| `site_access` | `(user_id, site_id)` | `user_id`, `site_id` | Granular user-to-site grants. Only Org Admins can manage. |
| `site_activation_history` | `id` (UUID) | `site_id`, `changed_by` | Audit trail of site status changes. Server-only write. |
| `subscriptions` | `id` (UUID) | `organisation_id` | Paid tenant plans. RLS: Org Admins & Finance Viewers only. |
| `subscription_items` | `id` (UUID) | `subscription_id`, `site_id` | Active product entitlements. Unique index prevents duplicate items. |
| `invoices` | `id` (UUID) | `organisation_id`, `subscription_id` | Billing invoices with paise integer amounts. Supports `FAILED` status. |
| `billing_checkout_sessions` | `id` (UUID) | `organisation_id`, `site_id` | Authoritative commercial binding before payment provider redirection. |
| `data_sources` | `id` (UUID) | `site_id` | Metering connection config (CSV upload, AMR, SFTP). |
| `ingestion_runs` | `id` (UUID) | `site_id`, `data_sources(id)` | Records file metadata and SHA-256 checksums. Server-only write. |
| `interval_data_96` | `(site_id, operating_date, block_index)` | `site_id`, `ingestion_run_id` | Core 15-minute AMR telemetry (96 blocks/day). Server-only write. |
| `grid_forecast_runs` | `id` (UUID) | `site_id` | Model execution headers. Server-only write. |
| `grid_forecast_blocks` | `(run_id, block_index)` | `grid_forecast_runs(id)` | 96-block day-ahead demand/price forecast. Canonical FK is `run_id`. Server-only write. |
| `dsm_incidents` | `id` (UUID) | `site_id` | Grouped grid frequency/deviation violations. Unique window index prevents duplicates. |
| `bess_assets` | `id` (UUID) | `site_id` | Battery physical specifications and SOC parameters. |
| `bess_signal_runs` | `id` (UUID) | `bess_assets(id)` | Advisory charge/discharge schedule output. Server-only write. |
| `renewable_assets` | `id` (UUID) | `site_id` | On-site solar / wind installation parameters. |
| `emission_factors` | `id` (UUID) | None | CEA grid emission factors. Seeded with CEA v19 (0.716 tCO₂e/MWh). |
| `regulatory_sources` | `id` (UUID) | None | Tariff orders and amendments. Approval gate filters unapproved rules. |
| `compliance_obligations` | `id` (UUID) | `regulatory_sources(id)` | Dynamic compliance action deadlines. Replaces static calendar data. |
| `alerts` | `id` (UUID) | `site_id` | Real-time threshold alerts. Updated via atomic acknowledgment RPC. |
| `notification_logs` | `id` (UUID) | `organisation_id` | Delivery tracking. Privacy RLS: Org Admins, Finance, and recipient only. |
| `report_records` | `id` (UUID) | `site_id`, `organisation_id` | Unified report metadata and storage paths. Server-only write. |
| `audit_logs` | `id` (UUID) | `organisation_id`, `site_id` | Cryptographically chained append-only audit trail. Immutable trigger. |

## 3. Authoritative PostgreSQL RPCs

### `commit_ingestion_transaction`
- **Purpose**: Atomically validates SHA-256 checksum, inserts ingestion run, upserts 96 interval blocks, evaluates 7-day calibration status, and writes audit record.
- **Security Definer**: YES (`SECURITY DEFINER SET search_path = public`).
- **Caller**: Server backend (`src/app/api/ingestion/commit/route.ts`).
- **Grants**: `REVOKE FROM PUBLIC, anon, authenticated; GRANT TO service_role`.
- **Tables Touched**: `ingestion_runs`, `interval_data_96`, `sites`, `site_activation_history`, `audit_logs`.
- **Proving Tests**: `tests/integration/adversarial_api.test.ts` (Test 8, 9), `tests/e2e/persistence_journey.spec.ts`.

### `acknowledge_alert_atomic`
- **Purpose**: Atomically marks an alert as `ACKNOWLEDGED` and appends an `ALERT_ACKNOWLEDGED` record to `audit_logs`.
- **Security Definer**: YES (`SECURITY DEFINER SET search_path = public`).
- **Caller**: Server backend (`src/app/api/alerts/[id]/acknowledge/route.ts`).
- **Grants**: `REVOKE FROM PUBLIC, anon, authenticated; GRANT TO service_role`.
- **Tables Touched**: `alerts`, `audit_logs`.
- **Proving Tests**: `tests/integration/adversarial_api.test.ts` (Test 20), `tests/e2e/demo_smoke.spec.ts`.

### `acknowledge_dsm_incident_atomic`
- **Purpose**: Atomically marks a DSM incident as acknowledged and appends a `DSM_INCIDENT_ACKNOWLEDGED` record to `audit_logs`.
- **Security Definer**: YES (`SECURITY DEFINER SET search_path = public`).
- **Caller**: Server backend (`src/app/api/dsm/route.ts`).
- **Grants**: `REVOKE FROM PUBLIC, anon, authenticated; GRANT TO service_role`.
- **Tables Touched**: `dsm_incidents`, `audit_logs`.
- **Proving Tests**: `tests/integration/adversarial_api.test.ts` (Test 30).

### `has_site_access(target_site_id UUID)`
- **Purpose**: Checks whether the current user (`auth.uid()`) has access to `target_site_id` via `site_access`, `ORGANISATION_ADMIN` role, or platform admin privilege.
- **Security Definer**: YES (`SECURITY DEFINER SET search_path = public`).
- **Caller**: PostgreSQL RLS policies & Next.js API guard.
- **Grants**: `GRANT TO anon, authenticated, service_role`.
- **Tables Touched**: `site_access`, `sites`, `memberships`.
- **Proving Tests**: `tests/integration/supabase_rls.test.ts` (Test 8).
