# Aetheon Energy Intelligence Platform - Data Model Specification (DATA_MODEL.md)

## 1. Tenancy & Core Entities

```sql
-- Organisations (Top-level tenant boundary)
CREATE TABLE organisations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    legal_entity_name VARCHAR(255) NOT NULL,
    gstin VARCHAR(15),
    billing_address JSONB NOT NULL DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sites (Operational metering/scheduling boundary)
CREATE TABLE sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    state VARCHAR(100) NOT NULL, -- e.g., 'Maharashtra', 'Gujarat', 'Uttar Pradesh'
    discom VARCHAR(100) NOT NULL, -- e.g., 'MSEDCL', 'UGVCL', 'PVVNL'
    voltage_category VARCHAR(50) NOT NULL, -- e.g., '11kV', '33kV', '66kV', '132kV'
    contract_demand_value NUMERIC(12, 2) NOT NULL,
    contract_demand_unit VARCHAR(10) NOT NULL DEFAULT 'kVA', -- 'kVA' or 'MVA'
    metering_point VARCHAR(255) NOT NULL,
    load_class VARCHAR(100) NOT NULL, -- e.g., 'Continuous Process Industrial', 'Commercial'
    timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Kolkata',
    activation_status VARCHAR(50) NOT NULL DEFAULT 'CONFIGURED', -- CONFIGURED, AWAITING_DATA, CALIBRATING, ACTIVE, DEGRADED
    activation_reason TEXT,
    last_status_change TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User Profiles & Memberships
CREATE TABLE user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    phone VARCHAR(20),
    is_platform_admin BOOLEAN NOT NULL DEFAULT false,
    mfa_enabled BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL, -- ORGANISATION_ADMIN, ENERGY_MANAGER, OPERATOR, FINANCE_SUSTAINABILITY_VIEWER, AETHEON_ANALYST, AETHEON_REGULATORY_REVIEWER
    is_active BOOLEAN NOT NULL DEFAULT true,
    expires_at TIMESTAMPTZ, -- for time-bounded analyst access
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(organisation_id, user_id)
);
```

## 2. Product Catalogue, Subscriptions & Entitlements

```sql
CREATE TABLE products (
    id VARCHAR(50) PRIMARY KEY, -- 'GRID_INTELLIGENCE', 'OA_COMPLIANCE', 'DSM_RISK', 'BESS_ARBITRAGE', 'RENEWABLE_PORTFOLIO'
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    base_price_paise BIGINT NOT NULL, -- e.g. 1990000 for ₹19,900
    billing_interval VARCHAR(20) NOT NULL DEFAULT 'MONTHLY',
    availability_status VARCHAR(50) NOT NULL DEFAULT 'AVAILABLE', -- DEVELOPMENT, DEMO, INTERNAL_VALIDATION, AVAILABLE, DEGRADED, RETIRED
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING', -- PENDING, ACTIVE, PAST_DUE, SUSPENDED, CANCELLED, EXPIRED
    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end TIMESTAMPTZ NOT NULL,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
    billing_provider_ref VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE entitlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    product_id VARCHAR(50) NOT NULL REFERENCES products(id),
    site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
    state_scope VARCHAR(100),
    is_active BOOLEAN NOT NULL DEFAULT true,
    valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_until TIMESTAMPTZ,
    granted_by VARCHAR(255) NOT NULL DEFAULT 'SYSTEM',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## 3. Data Gateway & Canonical Time Series (96 Blocks)

```sql
CREATE TABLE data_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    source_type VARCHAR(50) NOT NULL, -- CSV_UPLOAD, API, SFTP, MAILBOX, BILL_UPLOAD
    name VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_received_at TIMESTAMPTZ,
    freshness_status VARCHAR(50) NOT NULL DEFAULT 'UNKNOWN', -- RECENT, DELAYED, STALE, UNKNOWN, DEMO
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ingestion_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id UUID NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    checksum_sha256 VARCHAR(64) NOT NULL,
    status VARCHAR(50) NOT NULL, -- PENDING, VALIDATING, ACCEPTED, PARTIALLY_ACCEPTED, REJECTED
    total_rows INTEGER NOT NULL DEFAULT 0,
    accepted_rows INTEGER NOT NULL DEFAULT 0,
    rejected_rows INTEGER NOT NULL DEFAULT 0,
    error_summary JSONB DEFAULT '[]',
    uploaded_by UUID REFERENCES user_profiles(id),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE interval_data_96 (
    id BIGSERIAL PRIMARY KEY,
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    operating_date DATE NOT NULL,
    block_index INTEGER NOT NULL CHECK (block_index BETWEEN 1 AND 96),
    timestamp_utc TIMESTAMPTZ NOT NULL,
    load_kw NUMERIC(12, 3),
    generation_solar_kw NUMERIC(12, 3),
    grid_import_kw NUMERIC(12, 3),
    scheduled_drawal_kw NUMERIC(12, 3),
    actual_drawal_kw NUMERIC(12, 3),
    market_price_inr_per_mwh NUMERIC(12, 2),
    data_quality VARCHAR(20) NOT NULL DEFAULT 'PASSED',
    ingestion_run_id UUID REFERENCES ingestion_runs(id),
    UNIQUE(site_id, operating_date, block_index)
);
```

## 4. Regulatory Framework & Approval Workflow

```sql
CREATE TABLE regulatory_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    jurisdiction VARCHAR(100) NOT NULL, -- CERC, SERC, CEA
    state VARCHAR(100),
    discom VARCHAR(100),
    document_title VARCHAR(255) NOT NULL,
    source_url TEXT,
    document_date DATE NOT NULL,
    effective_date DATE NOT NULL,
    expiry_date DATE,
    version VARCHAR(50) NOT NULL,
    checksum VARCHAR(64),
    status VARCHAR(50) NOT NULL DEFAULT 'CAPTURED', -- CAPTURED, EXTRACTED, REVIEW_PENDING, APPROVED, PUBLISHED, SUPERSEDED
    approved_by UUID REFERENCES user_profiles(id),
    approved_at TIMESTAMPTZ,
    notes TEXT,
    is_demo BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## 5. Audit Log (Append-Only)

```sql
CREATE TABLE audit_logs (
    id BIGSERIAL PRIMARY KEY,
    organisation_id UUID REFERENCES organisations(id) ON DELETE SET NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    actor_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    actor_role VARCHAR(50) NOT NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id VARCHAR(255),
    details JSONB NOT NULL DEFAULT '{}',
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
