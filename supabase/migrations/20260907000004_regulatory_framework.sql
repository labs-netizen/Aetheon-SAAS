-- Aetheon Energy Intelligence Platform - Migration 04: Regulatory Framework & Approval Workflow
-- Implements regulatory source register, state transition machine, tariffs, DSM rules, and emission factors.

-- 1. Regulatory Sources
CREATE TABLE IF NOT EXISTS regulatory_sources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    jurisdiction VARCHAR(100) NOT NULL, -- CERC, SERC, CEA, FOR
    state VARCHAR(100),
    discom VARCHAR(100),
    document_title VARCHAR(255) NOT NULL,
    source_url TEXT,
    document_date DATE NOT NULL,
    effective_date DATE NOT NULL,
    expiry_date DATE,
    version VARCHAR(50) NOT NULL,
    checksum_sha256 VARCHAR(64),
    status VARCHAR(50) NOT NULL DEFAULT 'CAPTURED' CHECK (status IN (
        'CAPTURED',
        'EXTRACTED',
        'CHANGE_DETECTED',
        'REVIEW_PENDING',
        'APPROVED',
        'PUBLISHED',
        'SUPERSEDED'
    )),
    approved_by UUID REFERENCES user_profiles(id),
    approved_at TIMESTAMPTZ,
    notes TEXT,
    is_demo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. DISCOM Tariffs
CREATE TABLE IF NOT EXISTS discom_tariffs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    state VARCHAR(100) NOT NULL,
    discom VARCHAR(100) NOT NULL,
    voltage_category VARCHAR(50) NOT NULL,
    category_name VARCHAR(100) NOT NULL, -- e.g. HT-1 Industrial
    fixed_charge_inr_per_kva_month NUMERIC(10, 2) NOT NULL,
    energy_charge_normal_inr_per_kwh NUMERIC(8, 4) NOT NULL,
    tod_peak_surcharge_pct NUMERIC(6, 2) NOT NULL DEFAULT 20.0,
    tod_off_peak_rebate_pct NUMERIC(6, 2) NOT NULL DEFAULT 15.0,
    regulatory_source_id UUID REFERENCES regulatory_sources(id),
    effective_from DATE NOT NULL,
    effective_until DATE,
    is_demo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Open Access Charges (Wheeling, CSS, Additional Surcharge, Banking)
CREATE TABLE IF NOT EXISTS open_access_charges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    state VARCHAR(100) NOT NULL,
    discom VARCHAR(100) NOT NULL,
    voltage_category VARCHAR(50) NOT NULL,
    cross_subsidy_surcharge_inr_per_kwh NUMERIC(8, 4) NOT NULL,
    additional_surcharge_inr_per_kwh NUMERIC(8, 4) NOT NULL,
    wheeling_charge_inr_per_kwh NUMERIC(8, 4) NOT NULL,
    transmission_charge_inr_per_kwh NUMERIC(8, 4) NOT NULL,
    banking_charge_pct NUMERIC(6, 2) NOT NULL DEFAULT 5.0,
    regulatory_source_id UUID REFERENCES regulatory_sources(id),
    effective_from DATE NOT NULL,
    effective_until DATE,
    is_demo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Carbon Emission Factors
CREATE TABLE IF NOT EXISTS emission_factors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    jurisdiction VARCHAR(100) NOT NULL DEFAULT 'INDIA_NATIONAL_GRID',
    factor_value_tco2e_per_mwh NUMERIC(8, 4) NOT NULL,
    source_name VARCHAR(255) NOT NULL DEFAULT 'CEA Baseline Database',
    source_version VARCHAR(50) NOT NULL DEFAULT 'v19.0',
    effective_year INTEGER NOT NULL DEFAULT 2026,
    is_verified BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
