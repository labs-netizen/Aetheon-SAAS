-- Aetheon Energy Intelligence Platform - Migration 06: Alerts, Notifications & Reports
-- Implements common alert engine, deduplication fingerprint, email templates, and report provenance snapshots.

-- 1. Alert Definitions & System Alerts
CREATE TABLE IF NOT EXISTS alert_definitions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    module VARCHAR(50) NOT NULL, -- GRID, DSM, BESS, COMPLIANCE, RENEWABLE
    alert_type VARCHAR(100) NOT NULL,
    severity_threshold VARCHAR(20) NOT NULL DEFAULT 'WARNING'
        CHECK (severity_threshold IN ('INFO', 'WARNING', 'HIGH', 'CRITICAL')),
    threshold_value NUMERIC(12, 2),
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    module VARCHAR(50) NOT NULL,
    alert_type VARCHAR(100) NOT NULL,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'HIGH', 'CRITICAL')),
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    fingerprint VARCHAR(64) NOT NULL, -- For deduplication cooldown
    affected_block_start INTEGER,
    affected_block_end INTEGER,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED')),
    acknowledged_by UUID REFERENCES user_profiles(id),
    acknowledged_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    triggered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alerts_site_status ON alerts(site_id, status);
CREATE INDEX IF NOT EXISTS idx_alerts_fingerprint ON alerts(site_id, fingerprint, triggered_at DESC);

-- 2. Notification Templates & Event Logs
CREATE TABLE IF NOT EXISTS notification_templates (
    id VARCHAR(100) PRIMARY KEY, -- 'PAYMENT_CONFIRMED', 'SITE_CREATED', 'DATA_SOURCE_CONNECTED', 'DATA_VALIDATION_FAILED', 'PRODUCT_ACTIVATED', 'PAYMENT_FAILURE'
    title_template VARCHAR(255) NOT NULL,
    body_template TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_logs (
    id BIGSERIAL PRIMARY KEY,
    organisation_id UUID REFERENCES organisations(id) ON DELETE CASCADE,
    recipient_email VARCHAR(255) NOT NULL,
    template_id VARCHAR(100) NOT NULL REFERENCES notification_templates(id),
    subject VARCHAR(255) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    delivery_status VARCHAR(20) NOT NULL DEFAULT 'SENT' CHECK (delivery_status IN ('SENT', 'FAILED', 'QUEUED', 'LOGGED_DEV')),
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Reports & Calculation Provenance
CREATE TABLE IF NOT EXISTS report_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    module VARCHAR(50) NOT NULL,
    report_type VARCHAR(50) NOT NULL, -- DAILY_BRIEF, WEEKLY_SUMMARY, MONTHLY_PERFORMANCE, ESG_EMISSIONS
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    title VARCHAR(255) NOT NULL,
    summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    quality_status VARCHAR(20) NOT NULL DEFAULT 'PASSED',
    model_version VARCHAR(50) NOT NULL,
    tariff_version VARCHAR(50),
    rule_version VARCHAR(50),
    generation_time TIMESTAMPTZ NOT NULL DEFAULT now(),
    generated_by UUID REFERENCES user_profiles(id),
    download_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reports_site_module ON report_records(site_id, module, created_at DESC);
