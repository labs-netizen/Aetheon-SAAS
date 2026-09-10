-- Aetheon Energy Intelligence Platform - Migration 08: Security & Site Access Hardening
-- Enforces:
-- 1. Anti-privilege-escalation on user registration and profile updates
-- 2. Role boundary enforcement preventing customer Org Admins from assigning internal Aetheon roles
-- 3. Granular site-level access (has_site_access) across all site-scoped telemetry, assets, and analytics
-- 4. Server-only write protection on trusted analytical outputs (Forecasts, DSM, BESS, Quality Gates)
-- 5. Regulatory review publication gating (suppressing REVIEW_PENDING/DRAFT from customer queries)
-- 6. Tamper-evident audit logging with SHA-256 hash chaining
-- 7. Secure invitation workflow with strict customer role constraints

-- ============================================================================
-- 1. Anti-Privilege Escalation on User Profiles
-- ============================================================================

-- Unconditionally strip is_platform_admin from user metadata during signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.user_profiles (id, full_name, email, phone, is_platform_admin)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data->>'phone',
    false -- STRICT SECURITY REQUIREMENT: Metadata can NEVER self-grant platform admin privileges
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger preventing non-service-role clients from escalating is_platform_admin
CREATE OR REPLACE FUNCTION public.protect_user_profile_escalation()
RETURNS trigger AS $$
BEGIN
  IF NEW.is_platform_admin IS DISTINCT FROM OLD.is_platform_admin THEN
    IF current_setting('role', true) NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
      RAISE EXCEPTION 'SECURITY VIOLATION: Privilege escalation denied. is_platform_admin cannot be modified by user.';
    END IF;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_protect_user_profile_escalation ON public.user_profiles;
CREATE TRIGGER trg_protect_user_profile_escalation
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_user_profile_escalation();


-- ============================================================================
-- 2. Role Boundary Enforcement on Memberships
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enforce_membership_role_boundary()
RETURNS trigger AS $$
BEGIN
  -- Internal roles (AETHEON_ANALYST, AETHEON_REGULATORY_REVIEWER) cannot be assigned by customer Org Admins
  IF NEW.role IN ('AETHEON_ANALYST', 'AETHEON_REGULATORY_REVIEWER') THEN
    IF NOT (public.is_platform_admin() OR current_setting('role', true) IN ('service_role', 'postgres', 'supabase_admin')) THEN
      RAISE EXCEPTION 'SECURITY VIOLATION: Organisation administrators cannot assign internal Aetheon roles (%).', NEW.role;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_enforce_membership_role_boundary ON public.memberships;
CREATE TRIGGER trg_enforce_membership_role_boundary
  BEFORE INSERT OR UPDATE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.enforce_membership_role_boundary();


-- ============================================================================
-- 3. Granular Site-Level Access (has_site_access)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.has_site_access(target_site_id UUID) 
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 
        FROM sites s
        JOIN memberships m ON m.organisation_id = s.organisation_id
        WHERE s.id = target_site_id
          AND m.user_id = public.auth_user_id()
          AND m.is_active = true
          AND (m.expires_at IS NULL OR m.expires_at > now())
          AND (
              -- Organisation Admins have jurisdiction across all sites in their organisation
              m.role = 'ORGANISATION_ADMIN'
              -- Other customer roles (Energy Manager, Operator, Viewer) require explicit site grant
              OR EXISTS (
                  SELECT 1 FROM site_access sa 
                  WHERE sa.site_id = target_site_id 
                    AND sa.user_id = public.auth_user_id()
              )
          )
    ) OR public.is_platform_admin();
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

-- Helper to check if a user is an internal Aetheon specialist
CREATE OR REPLACE FUNCTION public.is_internal_aetheon_user() 
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.user_id = public.auth_user_id()
          AND m.role IN ('AETHEON_ANALYST', 'AETHEON_REGULATORY_REVIEWER')
          AND m.is_active = true
          AND (m.expires_at IS NULL OR m.expires_at > now())
    ) OR public.is_platform_admin();
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;


-- ============================================================================
-- 4. Harden RLS Policies with has_site_access and Least Privilege
-- ============================================================================

-- Sites
DROP POLICY IF EXISTS "Members can view sites within their organisation" ON sites;
CREATE POLICY "Users can view sites they have access to" ON sites FOR SELECT USING (
    has_site_access(id) OR has_org_role(organisation_id, 'ORGANISATION_ADMIN') OR is_platform_admin()
);

DROP POLICY IF EXISTS "Org admins and energy managers can modify sites" ON sites;
CREATE POLICY "Org admins can manage all sites; Energy managers can update permitted sites" ON sites FOR UPDATE USING (
    has_org_role(organisation_id, 'ORGANISATION_ADMIN') OR
    (has_org_role(organisation_id, 'ENERGY_MANAGER') AND has_site_access(id)) OR
    is_platform_admin()
);

-- Site Access table RLS
DROP POLICY IF EXISTS "Users can view site access for their org" ON site_access;
DROP POLICY IF EXISTS "Org admins can manage site access" ON site_access;
CREATE POLICY "Users can view their own site access or org admins view all" ON site_access FOR SELECT USING (
    user_id = auth_user_id() OR
    EXISTS (SELECT 1 FROM sites s WHERE s.id = site_access.site_id AND has_org_role(s.organisation_id, 'ORGANISATION_ADMIN')) OR
    is_platform_admin()
);

CREATE POLICY "Only Org Admins can manage site access grants" ON site_access FOR ALL USING (
    EXISTS (SELECT 1 FROM sites s WHERE s.id = site_access.site_id AND has_org_role(s.organisation_id, 'ORGANISATION_ADMIN')) OR
    is_platform_admin()
);

-- Interval Data (96 Blocks)
DROP POLICY IF EXISTS "Members can view interval data 96" ON interval_data_96;
DROP POLICY IF EXISTS "Members can insert interval data 96" ON interval_data_96;

CREATE POLICY "Users can view interval data for permitted sites" ON interval_data_96 FOR SELECT USING (
    has_site_access(site_id)
);

CREATE POLICY "Energy Managers and Org Admins can insert interval data for permitted sites" ON interval_data_96 FOR INSERT WITH CHECK (
    has_site_access(site_id) AND (
        EXISTS (SELECT 1 FROM sites s WHERE s.id = interval_data_96.site_id AND (
            has_org_role(s.organisation_id, 'ORGANISATION_ADMIN') OR
            has_org_role(s.organisation_id, 'ENERGY_MANAGER')
        )) OR is_platform_admin()
    )
);

-- Data Sources
DROP POLICY IF EXISTS "Members can view data sources" ON data_sources;
DROP POLICY IF EXISTS "Managers can manage data sources" ON data_sources;

CREATE POLICY "Users can view data sources for permitted sites" ON data_sources FOR SELECT USING (
    has_site_access(site_id)
);

CREATE POLICY "Energy Managers and Org Admins can manage data sources" ON data_sources FOR ALL USING (
    has_site_access(site_id) AND (
        EXISTS (SELECT 1 FROM sites s WHERE s.id = data_sources.site_id AND (
            has_org_role(s.organisation_id, 'ORGANISATION_ADMIN') OR
            has_org_role(s.organisation_id, 'ENERGY_MANAGER')
        )) OR is_platform_admin()
    )
);

-- Ingestion Runs
DROP POLICY IF EXISTS "Members can view ingestion runs" ON ingestion_runs;
DROP POLICY IF EXISTS "Members can insert ingestion runs" ON ingestion_runs;

CREATE POLICY "Users can view ingestion runs for permitted sites" ON ingestion_runs FOR SELECT USING (
    has_site_access(site_id)
);

CREATE POLICY "Energy Managers and Org Admins can insert ingestion runs" ON ingestion_runs FOR INSERT WITH CHECK (
    has_site_access(site_id) AND (
        EXISTS (SELECT 1 FROM sites s WHERE s.id = ingestion_runs.site_id AND (
            has_org_role(s.organisation_id, 'ORGANISATION_ADMIN') OR
            has_org_role(s.organisation_id, 'ENERGY_MANAGER')
        )) OR is_platform_admin()
    )
);

-- BESS Assets
DROP POLICY IF EXISTS "Members can view bess assets" ON bess_assets;
DROP POLICY IF EXISTS "Managers can manage bess assets" ON bess_assets;

CREATE POLICY "Users can view bess assets for permitted sites" ON bess_assets FOR SELECT USING (
    has_site_access(site_id)
);

CREATE POLICY "Energy Managers and Org Admins can manage bess assets" ON bess_assets FOR ALL USING (
    has_site_access(site_id) AND (
        EXISTS (SELECT 1 FROM sites s WHERE s.id = bess_assets.site_id AND (
            has_org_role(s.organisation_id, 'ORGANISATION_ADMIN') OR
            has_org_role(s.organisation_id, 'ENERGY_MANAGER')
        )) OR is_platform_admin()
    )
);

-- Renewable Assets
DROP POLICY IF EXISTS "Members can view renewable assets" ON renewable_assets;
DROP POLICY IF EXISTS "Managers can manage renewable assets" ON renewable_assets;

CREATE POLICY "Users can view renewable assets for permitted sites" ON renewable_assets FOR SELECT USING (
    has_site_access(site_id)
);

CREATE POLICY "Energy Managers and Org Admins can manage renewable assets" ON renewable_assets FOR ALL USING (
    has_site_access(site_id) AND (
        EXISTS (SELECT 1 FROM sites s WHERE s.id = renewable_assets.site_id AND (
            has_org_role(s.organisation_id, 'ORGANISATION_ADMIN') OR
            has_org_role(s.organisation_id, 'ENERGY_MANAGER')
        )) OR is_platform_admin()
    )
);

-- ============================================================================
-- 5. Server-Generated Trusted Outputs (Read by permitted users; Written ONLY by Service-Role/Backend)
-- ============================================================================

-- Grid Forecast Runs
DROP POLICY IF EXISTS "Members can view grid forecast runs" ON grid_forecast_runs;
DROP POLICY IF EXISTS "Members can insert grid forecast runs" ON grid_forecast_runs;

CREATE POLICY "Users can view grid forecast runs for permitted sites" ON grid_forecast_runs FOR SELECT USING (
    has_site_access(site_id)
);

CREATE POLICY "Server only write grid forecast runs" ON grid_forecast_runs FOR INSERT WITH CHECK (
    is_platform_admin() OR current_setting('role', true) IN ('service_role', 'postgres', 'supabase_admin')
);

-- Grid Forecast Blocks
DROP POLICY IF EXISTS "Members can view grid forecast blocks" ON grid_forecast_blocks;
DROP POLICY IF EXISTS "Members can insert grid forecast blocks" ON grid_forecast_blocks;

CREATE POLICY "Users can view grid forecast blocks for permitted sites" ON grid_forecast_blocks FOR SELECT USING (
    EXISTS (SELECT 1 FROM grid_forecast_runs r WHERE r.id = grid_forecast_blocks.run_id AND has_site_access(r.site_id))
);

CREATE POLICY "Server only write grid forecast blocks" ON grid_forecast_blocks FOR INSERT WITH CHECK (
    is_platform_admin() OR current_setting('role', true) IN ('service_role', 'postgres', 'supabase_admin')
);

-- DSM Incidents
DROP POLICY IF EXISTS "Members can view dsm incidents" ON dsm_incidents;
DROP POLICY IF EXISTS "Operators and managers can acknowledge dsm incidents" ON dsm_incidents;

CREATE POLICY "Users can view dsm incidents for permitted sites" ON dsm_incidents FOR SELECT USING (
    has_site_access(site_id)
);

CREATE POLICY "Operators and Managers can acknowledge incidents for permitted sites" ON dsm_incidents FOR UPDATE USING (
    has_site_access(site_id) AND (
        EXISTS (SELECT 1 FROM sites s WHERE s.id = dsm_incidents.site_id AND (
            has_org_role(s.organisation_id, 'ORGANISATION_ADMIN') OR
            has_org_role(s.organisation_id, 'ENERGY_MANAGER') OR
            has_org_role(s.organisation_id, 'OPERATOR')
        )) OR is_platform_admin()
    )
);

CREATE POLICY "Server only write dsm incidents" ON dsm_incidents FOR INSERT WITH CHECK (
    is_platform_admin() OR current_setting('role', true) IN ('service_role', 'postgres', 'supabase_admin')
);

-- BESS Signal Runs
DROP POLICY IF EXISTS "Members can view bess signal runs" ON bess_signal_runs;
DROP POLICY IF EXISTS "Managers can insert bess signal runs" ON bess_signal_runs;

CREATE POLICY "Users can view bess signal runs for permitted sites" ON bess_signal_runs FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM bess_assets b 
        WHERE b.id = bess_signal_runs.battery_id 
          AND has_site_access(b.site_id)
    )
);

CREATE POLICY "Server only write bess signal runs" ON bess_signal_runs FOR INSERT WITH CHECK (
    is_platform_admin() OR current_setting('role', true) IN ('service_role', 'postgres', 'supabase_admin')
);

-- Data Quality Evaluations
DROP POLICY IF EXISTS "Members can view data quality evaluations" ON data_quality_evaluations;

CREATE POLICY "Users can view data quality evaluations for permitted sites" ON data_quality_evaluations FOR SELECT USING (
    has_site_access(site_id)
);

CREATE POLICY "Server only write data quality evaluations" ON data_quality_evaluations FOR ALL USING (
    is_platform_admin() OR current_setting('role', true) IN ('service_role', 'postgres', 'supabase_admin')
);

-- Alerts
DROP POLICY IF EXISTS "Members can view alerts" ON alerts;
DROP POLICY IF EXISTS "Operators and managers can acknowledge alerts" ON alerts;

CREATE POLICY "Users can view alerts for permitted sites or org-wide" ON alerts FOR SELECT USING (
    (site_id IS NULL AND is_org_member(organisation_id)) OR
    has_site_access(site_id)
);

CREATE POLICY "Operators and above can acknowledge alerts" ON alerts FOR UPDATE USING (
    ((site_id IS NULL AND is_org_member(organisation_id)) OR has_site_access(site_id)) AND (
        has_org_role(organisation_id, 'ORGANISATION_ADMIN') OR
        has_org_role(organisation_id, 'ENERGY_MANAGER') OR
        has_org_role(organisation_id, 'OPERATOR') OR
        is_platform_admin()
    )
);

-- Report Records
DROP POLICY IF EXISTS "Members can view report records" ON report_records;
DROP POLICY IF EXISTS "Managers can create report records" ON report_records;

CREATE POLICY "Users can view reports for permitted sites or org-wide" ON report_records FOR SELECT USING (
    (site_id IS NULL AND is_org_member(organisation_id)) OR
    has_site_access(site_id)
);

CREATE POLICY "Server only insert report records" ON report_records FOR INSERT WITH CHECK (
    is_platform_admin() OR current_setting('role', true) IN ('service_role', 'postgres', 'supabase_admin')
);

-- Billing & Invoices: Strictly restricted to Org Admins and Finance Viewers
DROP POLICY IF EXISTS "Members can view subscriptions for their org" ON subscriptions;
DROP POLICY IF EXISTS "Members can view invoices for their org" ON invoices;
DROP POLICY IF EXISTS "Members can view billing customers" ON billing_customers;
DROP POLICY IF EXISTS "Members can view billing events" ON billing_events;

CREATE POLICY "Org Admins and Finance Viewers can view subscriptions" ON subscriptions FOR SELECT USING (
    has_org_role(organisation_id, 'ORGANISATION_ADMIN') OR
    has_org_role(organisation_id, 'FINANCE_SUSTAINABILITY_VIEWER') OR
    is_platform_admin()
);

CREATE POLICY "Org Admins and Finance Viewers can view invoices" ON invoices FOR SELECT USING (
    has_org_role(organisation_id, 'ORGANISATION_ADMIN') OR
    has_org_role(organisation_id, 'FINANCE_SUSTAINABILITY_VIEWER') OR
    is_platform_admin()
);

CREATE POLICY "Org Admins and Finance Viewers can view billing customers" ON billing_customers FOR SELECT USING (
    has_org_role(organisation_id, 'ORGANISATION_ADMIN') OR
    has_org_role(organisation_id, 'FINANCE_SUSTAINABILITY_VIEWER') OR
    is_platform_admin()
);

CREATE POLICY "Org Admins and Finance Viewers can view billing events" ON billing_events FOR SELECT USING (
    has_org_role(organisation_id, 'ORGANISATION_ADMIN') OR
    has_org_role(organisation_id, 'FINANCE_SUSTAINABILITY_VIEWER') OR
    is_platform_admin()
);


-- ============================================================================
-- 6. Regulatory Data Publication Gating
-- ============================================================================

-- Do NOT expose internal/draft/review-pending regulatory records through permissive USING (true)
DROP POLICY IF EXISTS "Public read regulatory_sources" ON regulatory_sources;
DROP POLICY IF EXISTS "Public read discom_tariffs" ON discom_tariffs;
DROP POLICY IF EXISTS "Public read open_access_charges" ON open_access_charges;
DROP POLICY IF EXISTS "Public read emission_factors" ON emission_factors;

CREATE POLICY "Customers view approved/published regulatory sources; Reviewers view all" ON regulatory_sources FOR SELECT USING (
    status IN ('APPROVED', 'PUBLISHED') OR
    public.is_internal_aetheon_user()
);

CREATE POLICY "Regulatory reviewers manage regulatory sources" ON regulatory_sources FOR ALL USING (
    public.is_internal_aetheon_user()
);

CREATE POLICY "Customers view approved/published discom tariffs; Reviewers view all" ON discom_tariffs FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM regulatory_sources rs 
        WHERE rs.id = discom_tariffs.regulatory_source_id 
          AND rs.status IN ('APPROVED', 'PUBLISHED')
    ) OR
    public.is_internal_aetheon_user()
);

CREATE POLICY "Regulatory reviewers manage discom tariffs" ON discom_tariffs FOR ALL USING (
    public.is_internal_aetheon_user()
);

CREATE POLICY "Customers view approved/published open access charges; Reviewers view all" ON open_access_charges FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM regulatory_sources rs 
        WHERE rs.id = open_access_charges.regulatory_source_id 
          AND rs.status IN ('APPROVED', 'PUBLISHED')
    ) OR
    public.is_internal_aetheon_user()
);

CREATE POLICY "Regulatory reviewers manage open access charges" ON open_access_charges FOR ALL USING (
    public.is_internal_aetheon_user()
);

CREATE POLICY "Customers view approved/published emission factors; Reviewers view all" ON emission_factors FOR SELECT USING (
    is_verified = true OR
    public.is_internal_aetheon_user()
);

CREATE POLICY "Regulatory reviewers manage emission factors" ON emission_factors FOR ALL USING (
    public.is_internal_aetheon_user()
);


-- ============================================================================
-- 7. Tamper-Evident Audit Logging with Hash Chaining
-- ============================================================================

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS previous_hash VARCHAR(64);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS current_hash VARCHAR(64);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS event_payload JSONB;

-- Append-only trigger for tamper-evident hash chaining
CREATE OR REPLACE FUNCTION public.chain_audit_log()
RETURNS trigger AS $$
DECLARE
  last_hash VARCHAR(64);
  computed_payload TEXT;
BEGIN
  -- Fetch the most recent hash for this organisation
  SELECT current_hash INTO last_hash
  FROM audit_logs
  WHERE organisation_id = NEW.organisation_id
  ORDER BY id DESC
  LIMIT 1;

  NEW.previous_hash := COALESCE(last_hash, 'GENESIS_ROOT_HASH_000000000000000000000000000000000000000000000000');
  
  -- Compute deterministic SHA-256 over: previous_hash + org + action + target + actor + timestamp
  computed_payload := NEW.previous_hash || '|' || 
                      NEW.organisation_id::text || '|' || 
                      NEW.action || '|' || 
                      COALESCE(NEW.target, '') || '|' || 
                      COALESCE(NEW.actor_id::text, 'SYSTEM') || '|' || 
                      NEW.created_at::text;

  NEW.current_hash := encode(sha256(computed_payload::bytea), 'hex');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_chain_audit_log ON public.audit_logs;
CREATE TRIGGER trg_chain_audit_log
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.chain_audit_log();

-- Strictly disallow UPDATE or DELETE on audit logs
CREATE OR REPLACE FUNCTION public.freeze_audit_log()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'SECURITY VIOLATION: Audit logs are immutable and cannot be updated or deleted.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_freeze_audit_log_update ON public.audit_logs;
CREATE TRIGGER trg_freeze_audit_log_update
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.freeze_audit_log();


-- ============================================================================
-- 8. Organisation Invitations Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS organisation_invitations (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN (
        'ORGANISATION_ADMIN',
        'ENERGY_MANAGER',
        'OPERATOR',
        'FINANCE_SUSTAINABILITY_VIEWER'
    )), -- Strictly customer roles
    site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
    token VARCHAR(64) NOT NULL UNIQUE,
    invited_by UUID REFERENCES user_profiles(id),
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED')),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE organisation_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org Admins can view and create invitations" ON organisation_invitations FOR ALL USING (
    has_org_role(organisation_id, 'ORGANISATION_ADMIN') OR is_platform_admin()
);

CREATE POLICY "Public token lookup for invitation acceptance" ON organisation_invitations FOR SELECT USING (
    status = 'PENDING' AND expires_at > now()
);
