-- Aetheon Energy Intelligence Platform - Migration 07: Row Level Security (RLS) Policies
-- Implements complete multi-tenant isolation, role checks, and catalog public read access.

-- 1. Helper functions for RLS
CREATE OR REPLACE FUNCTION auth_user_id() RETURNS UUID AS $$
    SELECT COALESCE(
        NULLIF(current_setting('request.jwt.claim.sub', true), ''),
        (auth.uid())::text
    )::uuid;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION is_org_member(target_org_id UUID) RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM memberships 
        WHERE organisation_id = target_org_id 
          AND user_id = auth_user_id()
          AND is_active = true
          AND (expires_at IS NULL OR expires_at > now())
    );
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION has_org_role(target_org_id UUID, required_role VARCHAR) RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM memberships 
        WHERE organisation_id = target_org_id 
          AND user_id = auth_user_id()
          AND role = required_role
          AND is_active = true
          AND (expires_at IS NULL OR expires_at > now())
    );
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION is_platform_admin() RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM user_profiles
        WHERE id = auth_user_id()
          AND is_platform_admin = true
    );
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

-- Enable RLS across all tables
ALTER TABLE organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_activation_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE interval_data_96 ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_quality_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE grid_forecast_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE grid_forecast_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsm_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE bess_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE bess_signal_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE renewable_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE discom_tariffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE open_access_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE emission_factors ENABLE ROW LEVEL SECURITY;

-- 2. Public / Reference Catalog Policies (Readable by all authenticated users)
CREATE POLICY "Public read products" ON products FOR SELECT USING (true);
CREATE POLICY "Public read notification_templates" ON notification_templates FOR SELECT USING (true);
CREATE POLICY "Public read regulatory_sources" ON regulatory_sources FOR SELECT USING (true);
CREATE POLICY "Public read discom_tariffs" ON discom_tariffs FOR SELECT USING (true);
CREATE POLICY "Public read open_access_charges" ON open_access_charges FOR SELECT USING (true);
CREATE POLICY "Public read emission_factors" ON emission_factors FOR SELECT USING (true);

-- 3. User Profiles Policies
CREATE POLICY "Users can view profiles in their organisations" ON user_profiles FOR SELECT USING (
    id = auth_user_id() OR
    is_platform_admin() OR
    EXISTS (
        SELECT 1 FROM memberships m1
        JOIN memberships m2 ON m1.organisation_id = m2.organisation_id
        WHERE m1.user_id = auth_user_id() AND m2.user_id = user_profiles.id
    )
);

CREATE POLICY "Users can update their own profile" ON user_profiles FOR UPDATE USING (
    id = auth_user_id()
);

-- 4. Organisations Policies
CREATE POLICY "Members can view their organisations" ON organisations FOR SELECT USING (
    is_org_member(id) OR is_platform_admin()
);

CREATE POLICY "Org admins can update their organisation" ON organisations FOR UPDATE USING (
    has_org_role(id, 'ORGANISATION_ADMIN') OR is_platform_admin()
);

-- 5. Memberships Policies
CREATE POLICY "Members can view memberships for their org" ON memberships FOR SELECT USING (
    user_id = auth_user_id() OR is_org_member(organisation_id) OR is_platform_admin()
);

CREATE POLICY "Org admins can manage memberships" ON memberships FOR ALL USING (
    has_org_role(organisation_id, 'ORGANISATION_ADMIN') OR is_platform_admin()
);

-- 6. Sites Policies
CREATE POLICY "Members can view sites within their organisation" ON sites FOR SELECT USING (
    is_org_member(organisation_id) OR is_platform_admin()
);

CREATE POLICY "Org admins and energy managers can modify sites" ON sites FOR ALL USING (
    has_org_role(organisation_id, 'ORGANISATION_ADMIN') OR 
    has_org_role(organisation_id, 'ENERGY_MANAGER') OR
    is_platform_admin()
);

-- 7. Site Access & Activation History
CREATE POLICY "Members can view site access" ON site_access FOR SELECT USING (
    EXISTS (SELECT 1 FROM sites WHERE sites.id = site_access.site_id AND is_org_member(sites.organisation_id)) OR
    user_id = auth_user_id() OR is_platform_admin()
);

CREATE POLICY "Org admins can manage site access" ON site_access FOR ALL USING (
    EXISTS (SELECT 1 FROM sites WHERE sites.id = site_access.site_id AND has_org_role(sites.organisation_id, 'ORGANISATION_ADMIN')) OR
    is_platform_admin()
);

CREATE POLICY "Members can view activation history" ON site_activation_history FOR SELECT USING (
    EXISTS (SELECT 1 FROM sites WHERE sites.id = site_activation_history.site_id AND is_org_member(sites.organisation_id)) OR
    is_platform_admin()
);

CREATE POLICY "Managers can insert activation history" ON site_activation_history FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM sites WHERE sites.id = site_activation_history.site_id AND (
        has_org_role(sites.organisation_id, 'ORGANISATION_ADMIN') OR
        has_org_role(sites.organisation_id, 'ENERGY_MANAGER')
    )) OR is_platform_admin()
);

-- 8. Subscriptions, Items, Invoices, Billing
CREATE POLICY "Members can view subscriptions" ON subscriptions FOR SELECT USING (
    is_org_member(organisation_id) OR is_platform_admin()
);

CREATE POLICY "Members can view subscription items" ON subscription_items FOR SELECT USING (
    EXISTS (SELECT 1 FROM subscriptions s WHERE s.id = subscription_items.subscription_id AND is_org_member(s.organisation_id)) OR
    is_platform_admin()
);

CREATE POLICY "Members can view entitlements" ON entitlements FOR SELECT USING (
    is_org_member(organisation_id) OR is_platform_admin()
);

CREATE POLICY "Members can view invoices" ON invoices FOR SELECT USING (
    is_org_member(organisation_id) OR is_platform_admin()
);

CREATE POLICY "Org admins can view billing customers" ON billing_customers FOR SELECT USING (
    has_org_role(organisation_id, 'ORGANISATION_ADMIN') OR is_platform_admin()
);

CREATE POLICY "Org admins can view billing events" ON billing_events FOR SELECT USING (
    has_org_role(organisation_id, 'ORGANISATION_ADMIN') OR is_platform_admin()
);

-- 9. Ingestion & Interval Data
CREATE POLICY "Members can view data sources" ON data_sources FOR SELECT USING (
    EXISTS (SELECT 1 FROM sites WHERE sites.id = data_sources.site_id AND is_org_member(sites.organisation_id)) OR
    is_platform_admin()
);

CREATE POLICY "Managers can manage data sources" ON data_sources FOR ALL USING (
    EXISTS (SELECT 1 FROM sites WHERE sites.id = data_sources.site_id AND (
        has_org_role(sites.organisation_id, 'ORGANISATION_ADMIN') OR
        has_org_role(sites.organisation_id, 'ENERGY_MANAGER')
    )) OR is_platform_admin()
);

CREATE POLICY "Members can view ingestion runs" ON ingestion_runs FOR SELECT USING (
    EXISTS (SELECT 1 FROM sites WHERE sites.id = ingestion_runs.site_id AND is_org_member(sites.organisation_id)) OR
    is_platform_admin()
);

CREATE POLICY "Members can insert ingestion runs" ON ingestion_runs FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM sites WHERE sites.id = ingestion_runs.site_id AND is_org_member(sites.organisation_id)) OR
    is_platform_admin()
);

CREATE POLICY "Members can view interval data 96" ON interval_data_96 FOR SELECT USING (
    EXISTS (SELECT 1 FROM sites WHERE sites.id = interval_data_96.site_id AND is_org_member(sites.organisation_id)) OR
    is_platform_admin()
);

CREATE POLICY "Members can insert interval data 96" ON interval_data_96 FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM sites WHERE sites.id = interval_data_96.site_id AND is_org_member(sites.organisation_id)) OR
    is_platform_admin()
);

CREATE POLICY "Members can view data quality evaluations" ON data_quality_evaluations FOR SELECT USING (
    EXISTS (SELECT 1 FROM sites WHERE sites.id = data_quality_evaluations.site_id AND is_org_member(sites.organisation_id)) OR
    is_platform_admin()
);

-- 10. Module Data (Grid Forecast, DSM, BESS, Renewable)
CREATE POLICY "Members can view grid forecast runs" ON grid_forecast_runs FOR SELECT USING (
    EXISTS (SELECT 1 FROM sites WHERE sites.id = grid_forecast_runs.site_id AND is_org_member(sites.organisation_id)) OR
    is_platform_admin()
);

CREATE POLICY "Members can insert grid forecast runs" ON grid_forecast_runs FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM sites WHERE sites.id = grid_forecast_runs.site_id AND is_org_member(sites.organisation_id)) OR
    is_platform_admin()
);

CREATE POLICY "Members can view grid forecast blocks" ON grid_forecast_blocks FOR SELECT USING (
    EXISTS (SELECT 1 FROM grid_forecast_runs r JOIN sites s ON s.id = r.site_id WHERE r.id = grid_forecast_blocks.run_id AND is_org_member(s.organisation_id)) OR
    is_platform_admin()
);

CREATE POLICY "Members can insert grid forecast blocks" ON grid_forecast_blocks FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM grid_forecast_runs r JOIN sites s ON s.id = r.site_id WHERE r.id = grid_forecast_blocks.run_id AND is_org_member(s.organisation_id)) OR
    is_platform_admin()
);

CREATE POLICY "Members can view dsm incidents" ON dsm_incidents FOR SELECT USING (
    EXISTS (SELECT 1 FROM sites WHERE sites.id = dsm_incidents.site_id AND is_org_member(sites.organisation_id)) OR
    is_platform_admin()
);

CREATE POLICY "Operators and managers can update dsm incidents" ON dsm_incidents FOR UPDATE USING (
    EXISTS (SELECT 1 FROM sites WHERE sites.id = dsm_incidents.site_id AND (
        has_org_role(sites.organisation_id, 'OPERATOR') OR
        has_org_role(sites.organisation_id, 'ENERGY_MANAGER') OR
        has_org_role(sites.organisation_id, 'ORGANISATION_ADMIN')
    )) OR is_platform_admin()
);

CREATE POLICY "Members can view bess assets" ON bess_assets FOR SELECT USING (
    EXISTS (SELECT 1 FROM sites WHERE sites.id = bess_assets.site_id AND is_org_member(sites.organisation_id)) OR
    is_platform_admin()
);

CREATE POLICY "Managers can modify bess assets" ON bess_assets FOR ALL USING (
    EXISTS (SELECT 1 FROM sites WHERE sites.id = bess_assets.site_id AND (
        has_org_role(sites.organisation_id, 'ORGANISATION_ADMIN') OR
        has_org_role(sites.organisation_id, 'ENERGY_MANAGER')
    )) OR is_platform_admin()
);

CREATE POLICY "Members can view bess signal runs" ON bess_signal_runs FOR SELECT USING (
    EXISTS (SELECT 1 FROM bess_assets b JOIN sites s ON s.id = b.site_id WHERE b.id = bess_signal_runs.battery_id AND is_org_member(s.organisation_id)) OR
    is_platform_admin()
);

CREATE POLICY "Members can insert bess signal runs" ON bess_signal_runs FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM bess_assets b JOIN sites s ON s.id = b.site_id WHERE b.id = bess_signal_runs.battery_id AND is_org_member(s.organisation_id)) OR
    is_platform_admin()
);

CREATE POLICY "Members can view renewable assets" ON renewable_assets FOR SELECT USING (
    EXISTS (SELECT 1 FROM sites WHERE sites.id = renewable_assets.site_id AND is_org_member(sites.organisation_id)) OR
    is_platform_admin()
);

CREATE POLICY "Managers can modify renewable assets" ON renewable_assets FOR ALL USING (
    EXISTS (SELECT 1 FROM sites WHERE sites.id = renewable_assets.site_id AND (
        has_org_role(sites.organisation_id, 'ORGANISATION_ADMIN') OR
        has_org_role(sites.organisation_id, 'ENERGY_MANAGER')
    )) OR is_platform_admin()
);

-- 11. Alerts, Notifications & Reports
CREATE POLICY "Members can view alert definitions" ON alert_definitions FOR SELECT USING (
    EXISTS (SELECT 1 FROM sites WHERE sites.id = alert_definitions.site_id AND is_org_member(sites.organisation_id)) OR
    is_platform_admin()
);

CREATE POLICY "Managers can modify alert definitions" ON alert_definitions FOR ALL USING (
    EXISTS (SELECT 1 FROM sites WHERE sites.id = alert_definitions.site_id AND (
        has_org_role(sites.organisation_id, 'ORGANISATION_ADMIN') OR
        has_org_role(sites.organisation_id, 'ENERGY_MANAGER')
    )) OR is_platform_admin()
);

CREATE POLICY "Members can view alerts" ON alerts FOR SELECT USING (
    is_org_member(organisation_id) OR is_platform_admin()
);

CREATE POLICY "Operators and managers can acknowledge alerts" ON alerts FOR UPDATE USING (
    has_org_role(organisation_id, 'OPERATOR') OR 
    has_org_role(organisation_id, 'ENERGY_MANAGER') OR
    has_org_role(organisation_id, 'ORGANISATION_ADMIN') OR
    is_platform_admin()
);

CREATE POLICY "Members can view notification logs" ON notification_logs FOR SELECT USING (
    is_org_member(organisation_id) OR is_platform_admin()
);

CREATE POLICY "Members can view reports" ON report_records FOR SELECT USING (
    is_org_member(organisation_id) OR is_platform_admin()
);

CREATE POLICY "Managers can generate reports" ON report_records FOR INSERT WITH CHECK (
    has_org_role(organisation_id, 'ORGANISATION_ADMIN') OR 
    has_org_role(organisation_id, 'ENERGY_MANAGER') OR
    is_platform_admin()
);

-- 12. Audit Logs
CREATE POLICY "Org admins can view audit logs" ON audit_logs FOR SELECT USING (
    has_org_role(organisation_id, 'ORGANISATION_ADMIN') OR is_platform_admin()
);

CREATE POLICY "System and users can insert audit records" ON audit_logs FOR INSERT WITH CHECK (true);
