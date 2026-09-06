-- Aetheon Energy Intelligence Platform - Migration 07: Row Level Security (RLS) Policies
-- Implements tenant isolation and membership-aware access controls.

-- Helper functions for RLS
CREATE OR REPLACE FUNCTION auth_user_id() RETURNS UUID AS $$
    SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION is_org_member(target_org_id UUID) RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM memberships 
        WHERE organisation_id = target_org_id 
          AND user_id = auth_user_id()
          AND is_active = true
          AND (expires_at IS NULL OR expires_at > now())
    );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION has_org_role(target_org_id UUID, required_role VARCHAR) RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM memberships 
        WHERE organisation_id = target_org_id 
          AND user_id = auth_user_id()
          AND role = required_role
          AND is_active = true
          AND (expires_at IS NULL OR expires_at > now())
    );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- Enable RLS across tenant-scoped tables
ALTER TABLE organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE interval_data_96 ENABLE ROW LEVEL SECURITY;
ALTER TABLE grid_forecast_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsm_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE bess_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE bess_signal_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE renewable_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- 1. Organisations Policies
CREATE POLICY "Members can view their organisations"
ON organisations FOR SELECT
USING (is_org_member(id));

CREATE POLICY "Org admins can update their organisation"
ON organisations FOR UPDATE
USING (has_org_role(id, 'ORGANISATION_ADMIN'));

-- 2. Sites Policies
CREATE POLICY "Members can view sites within their organisation"
ON sites FOR SELECT
USING (is_org_member(organisation_id));

CREATE POLICY "Org admins and energy managers can modify sites"
ON sites FOR ALL
USING (
    has_org_role(organisation_id, 'ORGANISATION_ADMIN') OR 
    has_org_role(organisation_id, 'ENERGY_MANAGER')
);

-- 3. Interval Data 96 Policies
CREATE POLICY "Members can view interval data for permitted sites"
ON interval_data_96 FOR SELECT
USING (
    EXISTS (SELECT 1 FROM sites WHERE sites.id = interval_data_96.site_id AND is_org_member(sites.organisation_id))
);

-- 4. Alerts Policies
CREATE POLICY "Members can view alerts for their organisation"
ON alerts FOR SELECT
USING (is_org_member(organisation_id));

CREATE POLICY "Operators and managers can acknowledge alerts"
ON alerts FOR UPDATE
USING (
    has_org_role(organisation_id, 'OPERATOR') OR 
    has_org_role(organisation_id, 'ENERGY_MANAGER') OR
    has_org_role(organisation_id, 'ORGANISATION_ADMIN')
);

-- 5. Audit Log Policies (Append only, read restricted to org admins)
CREATE POLICY "Org admins can view audit logs"
ON audit_logs FOR SELECT
USING (has_org_role(organisation_id, 'ORGANISATION_ADMIN'));

CREATE POLICY "System and users can insert audit records"
ON audit_logs FOR INSERT
WITH CHECK (true);
