-- Aetheon Energy Intelligence Platform - Migration 03: Data Gateway & Ingestion Architecture
-- Implements Data Sources, Ingestion Runs, Checksums, and Canonical 96-Block Readings.

-- 1. Data Sources
CREATE TABLE IF NOT EXISTS data_sources (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    source_type VARCHAR(50) NOT NULL CHECK (source_type IN ('CSV_UPLOAD', 'API', 'SFTP', 'MAILBOX', 'BILL_UPLOAD')),
    name VARCHAR(255) NOT NULL,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_received_at TIMESTAMPTZ,
    freshness_status VARCHAR(50) NOT NULL DEFAULT 'UNKNOWN'
        CHECK (freshness_status IN ('RECENT', 'DELAYED', 'STALE', 'UNKNOWN', 'DEMO')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_data_sources_site ON data_sources(site_id);

-- 2. Ingestion Runs (Tracking, Idempotency Checksum, Row-level Stats)
CREATE TABLE IF NOT EXISTS ingestion_runs (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    data_source_id UUID NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    checksum_sha256 VARCHAR(64) NOT NULL,
    status VARCHAR(50) NOT NULL CHECK (status IN ('PENDING', 'VALIDATING', 'ACCEPTED', 'PARTIALLY_ACCEPTED', 'REJECTED')),
    total_rows INTEGER NOT NULL DEFAULT 0,
    accepted_rows INTEGER NOT NULL DEFAULT 0,
    rejected_rows INTEGER NOT NULL DEFAULT 0,
    error_summary JSONB DEFAULT '[]'::jsonb,
    uploaded_by UUID REFERENCES user_profiles(id),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_site ON ingestion_runs(site_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_checksum ON ingestion_runs(site_id, checksum_sha256);

-- 3. Canonical 96-Block Interval Readings
CREATE TABLE IF NOT EXISTS interval_data_96 (
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
    data_quality VARCHAR(20) NOT NULL DEFAULT 'PASSED' CHECK (data_quality IN ('PASSED', 'WARNING', 'FAILED', 'STALE')),
    ingestion_run_id UUID REFERENCES ingestion_runs(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(site_id, operating_date, block_index)
);

CREATE INDEX IF NOT EXISTS idx_interval_date_block ON interval_data_96(site_id, operating_date, block_index);

-- 4. Central Data Quality Evaluations
CREATE TABLE IF NOT EXISTS data_quality_evaluations (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    evaluation_date DATE NOT NULL,
    completeness_pct NUMERIC(5, 2) NOT NULL,
    missing_blocks_count INTEGER NOT NULL DEFAULT 0,
    freshness_status VARCHAR(50) NOT NULL,
    validation_status VARCHAR(50) NOT NULL CHECK (validation_status IN ('PASSED', 'WARNING', 'FAILED', 'STALE')),
    publication_gate_status VARCHAR(50) NOT NULL CHECK (publication_gate_status IN (
        'PUBLISHABLE',
        'PUBLISHABLE_WITH_WARNING',
        'BLOCKED_STALE_DATA',
        'BLOCKED_MISSING_INPUT',
        'BLOCKED_INVALID_CONFIGURATION'
    )),
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dq_site_date ON data_quality_evaluations(site_id, evaluation_date DESC);
