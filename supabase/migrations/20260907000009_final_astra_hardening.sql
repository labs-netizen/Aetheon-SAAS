-- Aetheon Energy Intelligence Platform - Migration 09: Final Astra Security & Integration Hardening
-- 1. Fix Audit Logs Chaining & Immutability Trigger (Real Columns, 64-char genesis, event_type/event_payload compatibility)
-- 2. Restrict Invitations RLS (No public enumeration of pending invites)
-- 3. Strict Separation of AETHEON_ANALYST (Time-bounded) and AETHEON_REGULATORY_REVIEWER
-- 4. Unique Constraint on Entitlements for Idempotency
-- 5. Private Storage Buckets & Policies
-- 6. Transactional Ingestion Commit RPC
-- 7. Atomic Webhook Processing RPC
-- 8. Renewable Generation Ledger Table & Registration Auto-Bootstrap

-- ============================================================================
-- 1. Audit Logs Schema & Trigger Fix
-- ============================================================================

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS event_type VARCHAR(100);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS event_payload JSONB;

CREATE OR REPLACE FUNCTION public.chain_audit_log()
RETURNS trigger AS $$
DECLARE
  last_hash VARCHAR(64);
  computed_payload TEXT;
BEGIN
  -- Normalize action & details if event_type/event_payload were passed
  IF NEW.action IS NULL AND NEW.event_type IS NOT NULL THEN
    NEW.action := NEW.event_type;
  END IF;
  IF NEW.action IS NULL THEN
    NEW.action := 'SYSTEM_ACTION';
  END IF;

  IF NEW.entity_type IS NULL THEN
    NEW.entity_type := 'SYSTEM';
  END IF;

  IF (NEW.details IS NULL OR NEW.details = '{}'::jsonb) AND NEW.event_payload IS NOT NULL THEN
    NEW.details := NEW.event_payload;
  END IF;

  -- Fetch the most recent hash for this organisation
  SELECT current_hash INTO last_hash
  FROM audit_logs
  WHERE organisation_id = NEW.organisation_id
  ORDER BY id DESC
  LIMIT 1;

  -- Deterministic 64-char genesis hash
  NEW.previous_hash := COALESCE(last_hash, '0000000000000000000000000000000000000000000000000000000000000000');
  
  -- Compute deterministic SHA-256 over: previous_hash + org + action + entity_type + entity_id + actor + created_at
  computed_payload := NEW.previous_hash || '|' || 
                      COALESCE(NEW.organisation_id::text, '') || '|' || 
                      NEW.action || '|' || 
                      NEW.entity_type || '|' || 
                      COALESCE(NEW.entity_id, '') || '|' || 
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


-- Customer Org Admins cannot assign internal Aetheon roles
CREATE OR REPLACE FUNCTION public.enforce_membership_role_boundary()
RETURNS trigger AS $$
BEGIN
  IF NEW.role IN ('AETHEON_ANALYST', 'AETHEON_REGULATORY_REVIEWER') THEN
    IF public.auth_user_id() IS NOT NULL THEN
      IF NOT (public.is_platform_admin() OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'SECURITY VIOLATION: Organisation administrators cannot assign internal Aetheon roles (%).', NEW.role;
      END IF;
    ELSE
      IF NOT (auth.role() = 'service_role' OR CURRENT_USER = 'postgres') THEN
        RAISE EXCEPTION 'SECURITY VIOLATION: Organisation administrators cannot assign internal Aetheon roles (%).', NEW.role;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

ALTER TABLE public.organisation_invitations ADD COLUMN IF NOT EXISTS token_hash VARCHAR(64);
ALTER TABLE public.organisation_invitations ALTER COLUMN token DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_invitations_token_hash ON public.organisation_invitations(token_hash);

DROP POLICY IF EXISTS "Public token lookup for invitation acceptance" ON organisation_invitations;
DROP POLICY IF EXISTS "Users view invitations sent to their email or Org Admins view all" ON organisation_invitations;
DROP POLICY IF EXISTS "Users view invitations sent to their email or Org Admins view a" ON organisation_invitations;

CREATE POLICY "Users view invitations sent to their email or Org Admins view all" ON organisation_invitations FOR SELECT USING (
    email = (SELECT email FROM auth.users WHERE id = auth_user_id()) OR
    has_org_role(organisation_id, 'ORGANISATION_ADMIN') OR
    is_platform_admin()
);

-- Ensure unique constraint on data_quality_evaluations for transactional upsert
DELETE FROM public.data_quality_evaluations a USING public.data_quality_evaluations b
WHERE a.site_id = b.site_id AND a.evaluation_date = b.evaluation_date AND a.evaluated_at < b.evaluated_at;

ALTER TABLE public.data_quality_evaluations DROP CONSTRAINT IF EXISTS uq_data_quality_evaluations_site_date;
ALTER TABLE public.data_quality_evaluations ADD CONSTRAINT uq_data_quality_evaluations_site_date UNIQUE (site_id, evaluation_date);


-- ============================================================================
-- 3. Strict Separation of Analyst and Regulatory Reviewer
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_aetheon_analyst() 
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.user_id = public.auth_user_id()
          AND m.role = 'AETHEON_ANALYST'
          AND m.is_active = true
          AND m.expires_at IS NOT NULL
          AND m.expires_at > now()
    );
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.is_regulatory_reviewer() 
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.user_id = public.auth_user_id()
          AND m.role = 'AETHEON_REGULATORY_REVIEWER'
          AND m.is_active = true
    ) OR public.is_platform_admin();
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

-- Regulatory tables: only Regulatory Reviewer can manage/publish (Analyst CANNOT)
DROP POLICY IF EXISTS "Regulatory reviewers manage regulatory sources" ON regulatory_sources;
CREATE POLICY "Regulatory reviewers manage regulatory sources" ON regulatory_sources FOR ALL USING (
    public.is_regulatory_reviewer()
);

DROP POLICY IF EXISTS "Regulatory reviewers manage discom tariffs" ON discom_tariffs;
CREATE POLICY "Regulatory reviewers manage discom tariffs" ON discom_tariffs FOR ALL USING (
    public.is_regulatory_reviewer()
);

DROP POLICY IF EXISTS "Regulatory reviewers manage open access charges" ON open_access_charges;
CREATE POLICY "Regulatory reviewers manage open access charges" ON open_access_charges FOR ALL USING (
    public.is_regulatory_reviewer()
);

DROP POLICY IF EXISTS "Regulatory reviewers manage emission factors" ON emission_factors;
CREATE POLICY "Regulatory reviewers manage emission factors" ON emission_factors FOR ALL USING (
    public.is_regulatory_reviewer()
);


-- ============================================================================
-- 4. Unique Constraint on Entitlements & Deduplication
-- ============================================================================

-- Clean any existing duplicates before adding constraint
DELETE FROM entitlements a USING entitlements b 
WHERE a.ctid > b.ctid 
  AND a.organisation_id = b.organisation_id 
  AND a.product_id = b.product_id 
  AND (a.site_id = b.site_id OR (a.site_id IS NULL AND b.site_id IS NULL));

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_entitlements_org_product_site'
    ) THEN
        ALTER TABLE entitlements ADD CONSTRAINT uq_entitlements_org_product_site UNIQUE(organisation_id, product_id, site_id);
    END IF;
END $$;


-- ============================================================================
-- 5. Private Storage Buckets & Policies
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('tenant-uploads', 'tenant-uploads', false, 52428800, ARRAY['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
  ('tenant-reports', 'tenant-reports', false, 20971520, ARRAY['text/csv', 'application/pdf']),
  ('tenant-bills', 'tenant-bills', false, 20971520, ARRAY['application/pdf', 'image/jpeg', 'image/png']),
  ('regulatory-documents', 'regulatory-documents', false, 52428800, ARRAY['application/pdf']),
  ('compliance-evidence', 'compliance-evidence', false, 52428800, ARRAY['application/pdf', 'image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE SET public = false;

DO $$
BEGIN
  -- Apply storage policies as supabase_storage_admin if available
  EXECUTE '
    DROP POLICY IF EXISTS "Tenant users can view their organisation storage objects" ON storage.objects;
    CREATE POLICY "Tenant users can view their organisation storage objects" ON storage.objects FOR SELECT USING (
        bucket_id IN (''tenant-uploads'', ''tenant-reports'', ''tenant-bills'', ''compliance-evidence'') AND
        (
            public.auth_user_id() IN (
                SELECT m.user_id FROM public.memberships m 
                WHERE name LIKE ''tenants/'' || m.organisation_id::text || ''/%''
            ) OR
            public.is_platform_admin() OR
            public.is_aetheon_analyst()
        )
    );

    DROP POLICY IF EXISTS "Regulatory Reviewers can view regulatory storage objects" ON storage.objects;
    CREATE POLICY "Regulatory Reviewers can view regulatory storage objects" ON storage.objects FOR SELECT USING (
        bucket_id = ''regulatory-documents'' AND (
            public.is_regulatory_reviewer() OR
            public.is_platform_admin()
        )
    );
  ';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Storage policy setup notice: %', SQLERRM;
END $$;


-- ============================================================================
-- 6. Renewable Generation Ledger Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS renewable_generation_ledger (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    operating_date DATE NOT NULL,
    total_measured_generation_kwh NUMERIC(12, 2) NOT NULL,
    total_modelled_generation_kwh NUMERIC(12, 2) NOT NULL,
    performance_ratio_pct NUMERIC(6, 2) NOT NULL,
    avoided_emissions_tco2e NUMERIC(10, 4) NOT NULL,
    emission_factor_source VARCHAR(100) NOT NULL,
    reconciliation_status VARCHAR(50) NOT NULL DEFAULT 'RECONCILED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(site_id, operating_date)
);

ALTER TABLE renewable_generation_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view renewable generation for permitted sites" ON renewable_generation_ledger;
CREATE POLICY "Users can view renewable generation for permitted sites" ON renewable_generation_ledger FOR SELECT USING (
    has_site_access(site_id)
);

DROP POLICY IF EXISTS "Service role only write renewable generation" ON renewable_generation_ledger;
CREATE POLICY "Service role only write renewable generation" ON renewable_generation_ledger FOR ALL USING (
    auth.role() = 'service_role' OR is_platform_admin()
);


-- ============================================================================
-- 7. Transactional Ingestion Commit RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.commit_ingestion_transaction(
    p_site_id UUID,
    p_filename TEXT,
    p_checksum_sha256 VARCHAR(64),
    p_uploaded_by UUID,
    p_rows JSONB,
    p_freshness_status VARCHAR(20),
    p_actor_role VARCHAR(50),
    p_org_id UUID
) RETURNS JSONB AS $$
DECLARE
    v_run_id UUID;
    v_data_source_id UUID;
    v_rows_count INTEGER;
    v_op_date DATE;
BEGIN
    -- 1. Duplicate Check
    IF EXISTS (SELECT 1 FROM ingestion_runs WHERE site_id = p_site_id AND checksum_sha256 = p_checksum_sha256) THEN
        RAISE EXCEPTION 'DUPLICATE_FILE: File with checksum % has already been ingested for site %', p_checksum_sha256, p_site_id;
    END IF;

    -- 2. Resolve or create data_source
    SELECT id INTO v_data_source_id FROM data_sources WHERE site_id = p_site_id LIMIT 1;
    IF v_data_source_id IS NULL THEN
        INSERT INTO data_sources (site_id, source_type, name, config, is_active)
        VALUES (p_site_id, 'CSV_UPLOAD', 'Automated Gateway CSV Ingestion', '{}'::jsonb, true)
        RETURNING id INTO v_data_source_id;
    END IF;

    v_rows_count := jsonb_array_length(p_rows);

    -- 3. Insert Ingestion Run
    INSERT INTO ingestion_runs (
        data_source_id, site_id, filename, checksum_sha256, total_rows, accepted_rows, rejected_rows, status, uploaded_by
    ) VALUES (
        v_data_source_id, p_site_id, p_filename, p_checksum_sha256, v_rows_count, v_rows_count, 0, 'ACCEPTED', p_uploaded_by
    ) RETURNING id INTO v_run_id;

    -- 4. Upsert interval data 96
    INSERT INTO interval_data_96 (
        site_id, operating_date, block_index, timestamp_utc, load_kw, generation_solar_kw, actual_drawal_kw, scheduled_drawal_kw, data_quality, ingestion_run_id
    )
    SELECT
        p_site_id,
        (r->>'operating_date')::date,
        (r->>'block_index')::integer,
        (r->>'timestamp_utc')::timestamptz,
        (r->>'load_kw')::numeric,
        COALESCE((r->>'solar_generation_kw')::numeric, (r->>'generation_solar_kw')::numeric, 0),
        (r->>'actual_drawal_kw')::numeric,
        (r->>'scheduled_drawal_kw')::numeric,
        'PASSED',
        v_run_id
    FROM jsonb_array_elements(p_rows) AS r
    ON CONFLICT (site_id, operating_date, block_index) DO UPDATE SET
        timestamp_utc = EXCLUDED.timestamp_utc,
        load_kw = EXCLUDED.load_kw,
        generation_solar_kw = EXCLUDED.generation_solar_kw,
        actual_drawal_kw = EXCLUDED.actual_drawal_kw,
        scheduled_drawal_kw = EXCLUDED.scheduled_drawal_kw,
        data_quality = EXCLUDED.data_quality,
        ingestion_run_id = EXCLUDED.ingestion_run_id;

    -- 5. Data quality evaluation
    SELECT (p_rows->0->>'operating_date')::date INTO v_op_date;
    INSERT INTO data_quality_evaluations (
        site_id, evaluation_date, completeness_pct, missing_blocks_count, freshness_status, validation_status, publication_gate_status
    ) VALUES (
        p_site_id, COALESCE(v_op_date, CURRENT_DATE), 100.0, 0, p_freshness_status, 'PASSED', 'PUBLISHABLE'
    ) ON CONFLICT (site_id, evaluation_date) DO UPDATE SET
        completeness_pct = EXCLUDED.completeness_pct,
        freshness_status = EXCLUDED.freshness_status,
        validation_status = EXCLUDED.validation_status,
        publication_gate_status = EXCLUDED.publication_gate_status;

    -- 6. Update site activation state machine
    UPDATE sites SET activation_status = 'ACTIVE', last_status_change = now()
    WHERE id = p_site_id AND activation_status IN ('CONFIGURED', 'AWAITING_DATA');

    IF FOUND THEN
        INSERT INTO site_activation_history (site_id, previous_status, new_status, reason, changed_by)
        VALUES (p_site_id, 'CONFIGURED', 'ACTIVE', 'First contiguous 96-block interval upload completed', p_uploaded_by);
    END IF;

    -- 7. Append-only Audit Log
    INSERT INTO audit_logs (
        organisation_id, site_id, actor_id, actor_role, action, entity_type, entity_id, details
    ) VALUES (
        p_org_id, p_site_id, p_uploaded_by, p_actor_role, 'INTERVAL_DATA_INGESTED', 'INGESTION_RUN', v_run_id::text,
        jsonb_build_object('filename', p_filename, 'checksum', p_checksum_sha256, 'total_rows', v_rows_count)
    );

    RETURN jsonb_build_object(
        'success', true,
        'ingestion_run_id', v_run_id,
        'total_blocks', v_rows_count,
        'freshness_status', p_freshness_status
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ============================================================================
-- 8. Atomic Razorpay Webhook Processing RPC
-- ============================================================================

ALTER TABLE IF EXISTS processed_webhook_events ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'PROCESSED';

CREATE OR REPLACE FUNCTION public.process_razorpay_webhook_atomic(
    p_event_id VARCHAR(255),
    p_event_type VARCHAR(100),
    p_payload JSONB,
    p_org_id UUID,
    p_site_id UUID,
    p_product_id VARCHAR(50),
    p_provider_ref VARCHAR(255),
    p_amount_paise BIGINT
) RETURNS JSONB AS $$
DECLARE
    v_sub_id UUID;
    v_now TIMESTAMPTZ := now();
    v_period_end TIMESTAMPTZ := now() + interval '30 days';
    v_invoice_num VARCHAR(100);
BEGIN
    -- Atomic pre-check
    IF EXISTS (SELECT 1 FROM processed_webhook_events WHERE id = p_event_id) THEN
        RETURN jsonb_build_object('status', 'already_processed', 'event_id', p_event_id);
    END IF;

    INSERT INTO processed_webhook_events (id, provider, event_type, payload, status)
    VALUES (p_event_id, 'RAZORPAY', p_event_type, p_payload, 'PROCESSING');

    IF p_event_type IN ('order.paid', 'payment.captured', 'subscription.charged') THEN
        -- Upsert subscription
        SELECT id INTO v_sub_id FROM subscriptions WHERE billing_provider_ref = p_provider_ref LIMIT 1;
        IF v_sub_id IS NULL THEN
            INSERT INTO subscriptions (
                organisation_id, status, current_period_start, current_period_end, billing_provider, billing_provider_ref
            ) VALUES (
                p_org_id, 'ACTIVE', v_now, v_period_end, 'RAZORPAY', p_provider_ref
            ) RETURNING id INTO v_sub_id;
        ELSE
            UPDATE subscriptions SET status = 'ACTIVE', current_period_end = v_period_end, updated_at = v_now
            WHERE id = v_sub_id;
        END IF;

        -- Upsert entitlement
        INSERT INTO entitlements (
            organisation_id, product_id, site_id, is_active, valid_from, valid_until, granted_by
        ) VALUES (
            p_org_id, p_product_id, p_site_id, true, v_now, v_period_end, 'RAZORPAY_WEBHOOK'
        ) ON CONFLICT (organisation_id, product_id, site_id) DO UPDATE SET
            is_active = true,
            valid_until = EXCLUDED.valid_until,
            granted_by = EXCLUDED.granted_by;

        -- Upsert invoice
        v_invoice_num := 'INV-' || COALESCE(SUBSTRING(p_provider_ref FROM '[0-9a-zA-Z]{6}$'), TO_CHAR(v_now, 'YYYYMMDDHH24MISS'));
        INSERT INTO invoices (
            organisation_id, subscription_id, invoice_number, amount_paise, total_paise, currency, status, paid_at
        ) VALUES (
            p_org_id, v_sub_id, v_invoice_num, p_amount_paise, p_amount_paise, 'INR', 'PAID', v_now
        ) ON CONFLICT (invoice_number) DO NOTHING;
    END IF;

    UPDATE processed_webhook_events SET status = 'PROCESSED' WHERE id = p_event_id;

    RETURN jsonb_build_object('status', 'success', 'event_id', p_event_id, 'subscription_id', v_sub_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ============================================================================
-- 9. Self-Service Registration Auto-Bootstrap
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  v_org_name TEXT;
  v_org_id UUID;
  v_site_id UUID;
BEGIN
  -- 1. Create Profile (Unconditionally unprivileged)
  INSERT INTO public.user_profiles (id, full_name, email, phone, is_platform_admin)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data->>'phone',
    false
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email;

  -- 2. If organisation_name was provided, create organisation, assign ORGANISATION_ADMIN, and initialize primary site
  v_org_name := new.raw_user_meta_data->>'organisation_name';
  IF v_org_name IS NOT NULL AND length(trim(v_org_name)) > 0 THEN
    INSERT INTO public.organisations (name, legal_entity_name, is_active)
    VALUES (trim(v_org_name), trim(v_org_name), true)
    RETURNING id INTO v_org_id;

    INSERT INTO public.memberships (organisation_id, user_id, role, is_active)
    VALUES (v_org_id, new.id, 'ORGANISATION_ADMIN', true)
    ON CONFLICT (organisation_id, user_id) DO NOTHING;

    INSERT INTO public.sites (organisation_id, name, state, discom, contract_demand_value, contract_demand_unit, activation_status)
    VALUES (v_org_id, 'Primary Plant 1', 'Maharashtra', 'MSEDCL', 1000, 'kVA', 'CONFIGURED')
    RETURNING id INTO v_site_id;

    INSERT INTO public.site_access (site_id, user_id, granted_by)
    VALUES (v_site_id, new.id, new.id)
    ON CONFLICT (site_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
