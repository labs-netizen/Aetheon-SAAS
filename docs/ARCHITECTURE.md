# Aetheon Energy Intelligence Platform - System Architecture (ARCHITECTURE.md)

## 1. Executive Overview

The **Aetheon Energy Intelligence Platform** (`aetheon-saas`) is an enterprise-grade, multi-tenant algorithmic decision-support platform engineered specifically for Indian Commercial & Industrial (C&I) electricity consumers. The platform empowers energy managers, plant operators, and finance executives to minimize landed electricity costs, eliminate DSM penalties, streamline Open Access compliance, optimize battery storage (BESS), and track renewable portfolio performance.

### Operating Boundary Constraints
- **Advisory Only**: The platform generates standardized recurring digital intelligence outputs. It does **not** execute autonomous exchange bids (IEX/PXIL/HPX), modify SLDC schedules directly, control plant SCADA/BMS systems, dispatch physical hardware, or provide formal legal opinions.

---

## 2. Core Architecture Topology

The application follows a **Modular Monolith** pattern for the customer/admin portal (Next.js App Router) coupled with a decoupled Python numerical analytics service for specialized forecasting and mathematical modeling.

```
                    ┌──────────────────────────────────────────────┐
                    │               CLIENT BROWSER                 │
                    │   (Responsive Next.js App Router UI)         │
                    └──────────────────────┬───────────────────────┘
                                           │ HTTPS
                                           ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                      AETHEON MODULAR MONOLITH (NEXT.JS)                           │
│                                                                                   │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌─────────────────────────┐  │
│  │    Customer Portal   │  │    Admin Portal      │  │      Data Gateway       │  │
│  │  - Dashboard         │  │  - Launch Checklist  │  │  - CSV/XLSX Ingestion   │  │
│  │  - Grid Intelligence │  │  - Ingestion Runs    │  │  - Provider Interfaces  │  │
│  │  - OA Compliance     │  │  - Regulatory Queue  │  │    (SFTP/API/Mail/Bill) │  │
│  │  - DSM Risk Monitor  │  │  - Model Registry    │  │  - Block 1-96 Validator │  │
│  │  - BESS Arbitrage    │  │  - Audit Log Viewer  │  │  - Checksum Idempotency │  │
│  │  - Renewables        │  │  - Subscriptions     │  │  - Row-Level Errors     │  │
│  └──────────┬───────────┘  └──────────┬───────────┘  └────────────┬────────────┘  │
│             │                         │                           │               │
│             ▼                         ▼                           ▼               │
│  ┌─────────────────────────────────────────────────────────────────────────────┐  │
│  │                         CENTRAL DOMAIN CORE                                 │  │
│  │  - Central Publication Quality Gate (Blocks stale/missing data)             │  │
│  │  - Entitlement Engine (Enforces plan/site/state restrictions)               │  │
│  │  - Activation State Machine (Configured → AwaitingData → Calibrating → ...) │  │
│  │  - Event & Notification Hub (Lifecycle triggers)                            │  │
│  │  - Canonical 15-Min Indian Electricity Block Engine (Blocks 1-96)           │  │
│  └────────────────────────────────────┬────────────────────────────────────────┘  │
└───────────────────────────────────────┼───────────────────────────────────────────┘
                                        │
             ┌──────────────────────────┴──────────────────────────┐
             │ Internal Service                                    │ Supabase Client
             │ HTTP / Token Auth                                   │ (PostgreSQL + RLS)
             ▼                                                     ▼
┌──────────────────────────────┐                ┌───────────────────────────────────┐
│   ANALYTICS SERVICE (FASTAPI)│                │     SUPABASE / POSTGRESQL DB      │
│  - 96-Block Forecast Engine  │                │  - Multi-tenant Tenant Isolation  │
│  - DSM Deviation Engine      │                │  - Strict Row-Level Security      │
│  - BESS Advisory Solver      │                │  - Append-only Audit Log          │
│  - RE Generation Model       │                │  - Canonical Interval Time-series │
│  - Emission Factor Engine    │                │  - Regulatory Source & Rules DB   │
└──────────────────────────────┘                └───────────────────────────────────┘
```

---

## 3. Key Subsystems

### 3.1 Tenancy & Multi-Site Hierarchy
```
Organisation
  └── Site 1..N (Specific state, DISCOM, voltage level, contract demand in kVA/MVA)
        ├── Assets (BESS, Rooftop Solar, Captive Plants)
        ├── Data Sources (Smart Meters, Ingestion Runs)
        └── Subscriptions & Entitlements
```

### 3.2 Canonical Indian Electricity Time Model
- **Day Boundary**: Midnight to midnight IST (`Asia/Kolkata`).
- **Resolution**: 96 uniform 15-minute time blocks per operating day.
  - Block 1: `00:00 - 00:15`
  - Block 48: `11:45 - 12:00`
  - Block 96: `23:45 - 24:00`
- Timestamp storage: Always canonical ISO-8601 UTC with explicit block indices stored alongside to guarantee zero timezone ambiguity during daylight/grid reconciliation.

### 3.3 Central Data Quality & Publication Quality Gate
Operational intelligence is verified by `PublicationQualityGate` before display:
1. **Freshness Check**: Data freshness status (`RECENT`, `DELAYED`, `STALE`, `UNKNOWN`, `DEMO`).
2. **Completeness Check**: 96/96 blocks must be present for full day scheduling.
3. **Suppression Behavior**: If telemetry or schedule data is missing or stale, active advisory recommendations (e.g., BESS dispatch windows or DSM risk actions) are **hard-suppressed** and replaced with an alert informing the user why calculations are paused and the remediation steps required.

### 3.4 Regulatory Workflow & Source DB
```
[CAPTURED] ──► [EXTRACTED] ──► [REVIEW_PENDING] ──► [APPROVED] ──► [PUBLISHED] ──► [SUPERSEDED]
                                       │
                                       ▼ (Blocked from customer view)
```
- No regulatory interpretation or tariff order becomes customer-facing without explicit approval by an `AETHEON_REGULATORY_REVIEWER`.
- Synthetic data is tagged `DEMO / UNVERIFIED`.

### 3.5 BESS Advisory Engine & Safety Guardrails
- **Terminological Strictness**: Uses "Recommended charge/discharge opportunity windows". Autonomous dispatch language is strictly forbidden.
- **Interlock Safeguards**: Advisory output is suppressed if:
  - Telemetry is stale (> 30 minutes)
  - SOC is unknown or out-of-bounds (< min_soc or > max_soc)
  - Asset maintenance lockout flag is set to true
  - Conflicting electrical constraints exist (e.g. interconnection export limits).

---

## 4. Product Modules Matrix

| Module | Primary Function | First Sellable Target | Status Baseline |
|---|---|---|---|
| **Grid Intelligence** | 96-block price/demand forecast, Daily Grid Brief, Cost Explorer | **Deepest Implementation (Priority #1)** | Production Foundation / Demo |
| **Open Access Compliance** | Rule tracker, DISCOM charges (CSS, AS, Wheeling), Compliance calendar | Secondary Target | Functional Framework / Demo Rules |
| **DSM Risk Monitor** | Scheduled vs actual deviation, risk bands (Normal/Watch/High/Critical), incidents | Secondary Target | Functional Framework / Demo Engine |
| **BESS Arbitrage** | Opportunity windows, degradation-aware net value calculation | Secondary Target | Functional Framework / Safe Demo Solver |
| **Renewable Portfolio** | Generation vs model, self-consumption %, carbon emissions tracking | Secondary Target | Functional Framework / Demo Assets |
