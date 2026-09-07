# Aetheon Energy Intelligence Platform - Architectural Decisions Log (DECISIONS.md)

This log records foundational engineering decisions, trade-offs, and boundary definitions made during repository construction, aligned with the Master Implementation Directive and Mandatory Amendments.

---

## ADR-001: Modular Monolith Architecture for Main Application
- **Context**: The platform provides algorithmic decision support across 5 core modules: Grid Intelligence, Open Access Compliance, DSM Risk Monitor, BESS Arbitrage, and Renewable Portfolio.
- **Decision**: Next.js App Router (TypeScript) with modular monolith folder architecture (`src/modules/*`, `src/features/*`, `src/components/*`).
- **Rationale**: Prevents premature microservice fragmentation while maintaining strict domain separation, unified multi-tenant session management, and shared design tokens.

## ADR-002: Real PostgreSQL / Supabase Migration Schema
- **Context**: Supabase is the preferred managed foundation for tenancy, authentication, storage, and RLS.
- **Decision**: Write full production-grade SQL migrations in `supabase/migrations/` using standard PostgreSQL DDL, composite indexes, and strict Row Level Security (RLS). Provide mock/replaceable adapters only for external third-party services (market data, Razorpay, email, meter/EMS, weather).
- **Rationale**: Ensures database migrations are directly runnable against real local Supabase / PostgreSQL instances without synthetic ORM locks.

## ADR-003: Platform Roles & Least Privilege Enforcement
- **Context**: Different enterprise personas require strict authorization boundaries.
- **Decision**: Implement the 6 exact platform roles:
  1. `ORGANISATION_ADMIN`: Full organization, billing, user, site, and subscription management.
  2. `ENERGY_MANAGER`: Operational module viewing, asset configuration, data import, report export.
  3. `OPERATOR`: Operational alerts viewing, incident acknowledgment. No commercial/billing privileges.
  4. `FINANCE_SUSTAINABILITY_VIEWER`: Read-only access to billing, ESG, and financial reports.
  5. `AETHEON_ANALYST`: Internal support role with time-bounded, audited, least-privilege access.
  6. `AETHEON_REGULATORY_REVIEWER`: Internal regulatory publishing role with zero billing privileges.
- **Rationale**: Prevents privilege escalation and separates customer commercial authority from regulatory verification.

## ADR-004: Decoupling Commercial Subscription from Operational Monitoring State
- **Context**: A customer may pay for a subscription while site telemetry or metering inputs are not yet connected or calibrated.
- **Decision**: Strictly isolate Commercial Subscription State (`PENDING`, `ACTIVE`, `PAST_DUE`, `CANCELLED`) from Operational Activation State (`CONFIGURED` → `AWAITING_DATA` → `CALIBRATING` → `ACTIVE` / `DEGRADED`).
- **Rationale**: Payment confirms commercial entitlement but must never mislead users into believing real-time operational monitoring is active without valid data.

## ADR-005: Regulatory Approval Workflow & Verification Policy
- **Context**: Regulatory filings, DISCOM tariff orders, and DSM amendments directly impact C&I energy decisions.
- **Decision**: Implement a 6-stage lifecycle:
  `CAPTURED` → `EXTRACTED` → `CHANGE_DETECTED/REVIEW_PENDING` → `APPROVED` → `PUBLISHED` → `SUPERSEDED`.
  Customer-facing calculations and UI will never expose data from `REVIEW_PENDING` or unapproved states.
  All synthetic/demo regulatory data must be stamped `DEMO / UNVERIFIED`.

## ADR-006: Central Data Quality & Publication Quality Gate
- **Context**: Algorithmic decision support with stale or incomplete input can lead to financial loss or regulatory penalties.
- **Decision**: Implement a centralized Quality Gate service. Every operational output must carry complete provenance (timestamp, completeness %, freshness, model version, tariff version). When critical input is stale or missing, recommendations are hard-suppressed with a clear remediation message rather than displayed with a mere warning badge.

## ADR-007: Indian 15-Minute Electricity Block Standard (96 Blocks)
- **Context**: Indian power grid, Open Access scheduling, and DSM mechanisms operate strictly on 15-minute time blocks (96 blocks per operating day from 00:00 to 24:00 IST).
- **Decision**: Implement canonical 96-block utilities with conversion between Date + Block (1–96) and UTC/IST canonical ISO timestamps. All interval data, load schedules, solar generation, and market clearing prices use Block Index 1–96.

## ADR-008: BESS Advisory Language & Safety Suppression
- **Context**: The platform is an advisory decision-support system, not a plant-control system (SCADA/BMS).
- **Decision**: Use the terminology "Recommended charge/discharge opportunity windows". Autonomous dispatch language is strictly prohibited. Hard-disable signals when SOC is unknown, telemetry is stale, maintenance lock is enabled, or constraints conflict.

## ADR-009: Highest Priority Module - Grid Intelligence Monitor
- **Context**: Delivering a production-grade foundation requires deep vertical completeness in the primary sellable product.
- **Decision**: Grid Intelligence Monitor will be implemented with complete end-to-end depth (Daily Grid Brief, 96-block forecast, Cost Explorer, weekly summary, monthly report, CSV/PDF export). Other modules (DSM, BESS, Renewables, Compliance) are fully scaffolded with functional UI and transparent `DEMO / INTERNAL_VALIDATION` indicators.
