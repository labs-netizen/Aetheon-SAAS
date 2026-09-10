-- Aetheon Energy Intelligence Platform - Migration 01: Core Tenancy & User Roles
-- Defines multi-tenant hierarchy: Organisations -> Sites -> User Profiles -> Memberships -> Audit Logs

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Organisations (Tenant Root)
CREATE TABLE IF NOT EXISTS organisations (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    legal_entity_name VARCHAR(255) NOT NULL,
    gstin VARCHAR(15),
    billing_address JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Sites (Operational metering & scheduling boundary)
CREATE TABLE IF NOT EXISTS sites (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    state VARCHAR(100) NOT NULL,
    discom VARCHAR(100) NOT NULL,
    voltage_category VARCHAR(50) NOT NULL, -- e.g. 11kV, 33kV, 66kV, 132kV
    contract_demand_value NUMERIC(12, 2) NOT NULL CHECK (contract_demand_value > 0),
    contract_demand_unit VARCHAR(10) NOT NULL DEFAULT 'kVA' CHECK (contract_demand_unit IN ('kVA', 'MVA')),
    metering_point VARCHAR(255) NOT NULL,
    load_class VARCHAR(100) NOT NULL DEFAULT 'Industrial C&I',
    timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Kolkata',
    activation_status VARCHAR(50) NOT NULL DEFAULT 'CONFIGURED' 
        CHECK (activation_status IN ('CONFIGURED', 'AWAITING_DATA', 'CALIBRATING', 'ACTIVE', 'DEGRADED')),
    activation_reason TEXT,
    last_status_change TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_demo BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sites_org ON sites(organisation_id);
CREATE INDEX IF NOT EXISTS idx_sites_state_discom ON sites(state, discom);

-- 3. User Profiles
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY, -- Maps to auth.users.id
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    phone VARCHAR(20),
    is_platform_admin BOOLEAN NOT NULL DEFAULT false,
    mfa_enabled BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Memberships & Exact Platform Roles
CREATE TABLE IF NOT EXISTS memberships (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL CHECK (role IN (
        'ORGANISATION_ADMIN',
        'ENERGY_MANAGER',
        'OPERATOR',
        'FINANCE_SUSTAINABILITY_VIEWER',
        'AETHEON_ANALYST',
        'AETHEON_REGULATORY_REVIEWER'
    )),
    is_active BOOLEAN NOT NULL DEFAULT true,
    expires_at TIMESTAMPTZ, -- Mandatory for AETHEON_ANALYST time-bounded access
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(organisation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_org_role ON memberships(organisation_id, role);

-- 5. Append-only Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    organisation_id UUID REFERENCES organisations(id) ON DELETE SET NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    actor_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    actor_role VARCHAR(50) NOT NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id VARCHAR(255),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_org_created ON audit_logs(organisation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id);

-- 6. Granular Site-Level Access
CREATE TABLE IF NOT EXISTS site_access (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    granted_by UUID REFERENCES user_profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(site_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_site_access_user ON site_access(user_id);
CREATE INDEX IF NOT EXISTS idx_site_access_site ON site_access(site_id);

-- 7. Site Activation History (5-stage lifecycle audit)
CREATE TABLE IF NOT EXISTS site_activation_history (
    id BIGSERIAL PRIMARY KEY,
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    previous_status VARCHAR(50),
    new_status VARCHAR(50) NOT NULL CHECK (new_status IN ('CONFIGURED', 'AWAITING_DATA', 'CALIBRATING', 'ACTIVE', 'DEGRADED')),
    reason TEXT,
    changed_by UUID REFERENCES user_profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activation_history_site ON site_activation_history(site_id, created_at DESC);

-- 8. Auth User Bootstrap Trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.user_profiles (id, full_name, email, phone, is_platform_admin)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data->>'phone',
    COALESCE((new.raw_user_meta_data->>'is_platform_admin')::boolean, false)
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
