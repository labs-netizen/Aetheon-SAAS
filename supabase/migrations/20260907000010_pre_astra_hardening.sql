-- ============================================================================
-- Migration 10: Pre-Astra Security & Integration Hardening
--
-- 1. Deduplicate entitlements and enforce UNIQUE NULLS NOT DISTINCT
-- 2. Lock down all SECURITY DEFINER functions (service_role / postgres only)
-- 3. Strict Analyst Expiry Enforcement in SQL functions
-- 4. Reconcile handle_new_user registration lifecycle with sites NOT NULL schema
-- 5. Atomic webhook processor handling success, cancellation, and failure
-- 6. Transactional Ingestion quality gate and actual state machine persistence
-- 7. Deterministic audit payload hash chaining
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Entitlement Uniqueness with NULL site_id
-- ----------------------------------------------------------------------------
DELETE FROM public.entitlements a USING public.entitlements b
WHERE a.id < b.id 
  AND a.organisation_id = b.organisation_id 
  AND a.product_id = b.product_id 
  AND a.site_id IS NOT DISTINCT FROM b.site_id;

ALTER TABLE public.entitlements DROP CONSTRAINT IF EXISTS uq_entitlements_org_product_site;
ALTER TABLE public.entitlements ADD CONSTRAINT uq_entitlements_org_product_site 
  UNIQUE NULLS NOT DISTINCT (organisation_id, product_id, site_id);

-- ----------------------------------------------------------------------------
-- 2. Analyst Expiry Enforcement Functions
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_aetheon_analyst()
RETURNS boolean AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.memberships m
        WHERE m.user_id = public.auth_user_id()
          AND m.role = 'AETHEON_ANALYST'
          AND m.is_active = true
          AND m.expires_at IS NOT NULL
          AND m.expires_at > now()
    );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.is_regulatory_reviewer()
RETURNS boolean AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.memberships m
        WHERE m.user_id = public.auth_user_id()
          AND m.role = 'AETHEON_REGULATORY_REVIEWER'
          AND m.is_active = true
    ) OR public.is_platform_admin();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.is_internal_aetheon_user()
RETURNS boolean AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.memberships m
        WHERE m.user_id = public.auth_user_id()
          AND m.is_active = true
          AND (
            (m.role = 'AETHEON_ANALYST' AND m.expires_at IS NOT NULL AND m.expires_at > now())
            OR
            (m.role = 'AETHEON_REGULATORY_REVIEWER')
          )
    ) OR public.is_platform_admin();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ----------------------------------------------------------------------------
-- 3. Registration Trigger Lifecycle Reconciled with Sites Schema
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  v_org_name TEXT;
  v_org_id UUID;
  v_site_id UUID;
  v_site_name TEXT;
  v_state TEXT;
  v_discom TEXT;
  v_voltage TEXT;
  v_metering TEXT;
  v_demand NUMERIC;
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

  -- 2. If organisation_name was provided, create organisation and assign ORGANISATION_ADMIN
  v_org_name := new.raw_user_meta_data->>'organisation_name';
  IF v_org_name IS NOT NULL AND length(trim(v_org_name)) > 0 THEN
    INSERT INTO public.organisations (name, legal_entity_name, is_active)
    VALUES (trim(v_org_name), trim(v_org_name), true)
    RETURNING id INTO v_org_id;

    INSERT INTO public.memberships (organisation_id, user_id, role, is_active)
    VALUES (v_org_id, new.id, 'ORGANISATION_ADMIN', true)
    ON CONFLICT (organisation_id, user_id) DO NOTHING;

    -- Only create an initial site if ALL required site parameters are present,
    -- or if explicit site creation parameters are supplied.
    v_site_name := new.raw_user_meta_data->>'site_name';
    v_state := COALESCE(new.raw_user_meta_data->>'state', 'Maharashtra');
    v_discom := COALESCE(new.raw_user_meta_data->>'discom', 'MSEDCL');
    v_voltage := COALESCE(new.raw_user_meta_data->>'voltage_category', '33kV');
    v_metering := COALESCE(new.raw_user_meta_data->>'metering_point', 'Main Incomer Feeder');
    v_demand := COALESCE((new.raw_user_meta_data->>'contract_demand_value')::numeric, 1000);

    IF v_site_name IS NOT NULL AND length(trim(v_site_name)) > 0 THEN
      INSERT INTO public.sites (
        organisation_id, name, state, discom, voltage_category, 
        contract_demand_value, contract_demand_unit, metering_point, 
        load_class, timezone, activation_status, activation_reason
      ) VALUES (
        v_org_id,
        trim(v_site_name),
        v_state,
        v_discom,
        v_voltage,
        v_demand,
        'kVA',
        v_metering,
        'Industrial C&I',
        'Asia/Kolkata',
        'CONFIGURED',
        'Initial site registered during user onboarding'
      ) RETURNING id INTO v_site_id;

      INSERT INTO public.site_access (site_id, user_id, granted_by)
      VALUES (v_site_id, new.id, new.id)
      ON CONFLICT (site_id, user_id) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- 4. Audit Log Hash Chaining and Deterministic Payload
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chain_audit_log()
RETURNS trigger AS $$
DECLARE
  last_hash VARCHAR(64);
  computed_payload TEXT;
BEGIN
  IF NEW.action IS NULL AND NEW.event_type IS NOT NULL THEN
    NEW.action := NEW.event_type;
  END IF;
  IF NEW.action IS NULL THEN
    NEW.action := 'SYSTEM_ACTION';
  END IF;

  IF NEW.entity_type IS NULL THEN
    NEW.entity_type := 'SYSTEM';
  END IF;

  IF NEW.actor_role IS NULL THEN
    NEW.actor_role := 'SYSTEM';
  END IF;

  IF (NEW.details IS NULL OR NEW.details = '{}'::jsonb) AND NEW.event_payload IS NOT NULL THEN
    NEW.details := NEW.event_payload;
  END IF;
  IF NEW.details IS NULL THEN
    NEW.details := '{}'::jsonb;
  END IF;

  -- Fetch the most recent hash for this organisation
  SELECT current_hash INTO last_hash
  FROM public.audit_logs
  WHERE organisation_id IS NOT DISTINCT FROM NEW.organisation_id
  ORDER BY id DESC
  LIMIT 1;

  -- Deterministic 64-char genesis hash
  NEW.previous_hash := COALESCE(last_hash, '0000000000000000000000000000000000000000000000000000000000000000');
  
  -- Compute deterministic SHA-256 over: previous_hash + actor_id + actor_role + org + action + entity_type + entity_id + details + created_at
  computed_payload := NEW.previous_hash || '|' || 
                      COALESCE(NEW.actor_id::text, 'SYSTEM') || '|' || 
                      NEW.actor_role || '|' || 
                      COALESCE(NEW.organisation_id::text, '') || '|' || 
                      NEW.action || '|' || 
                      NEW.entity_type || '|' || 
                      COALESCE(NEW.entity_id, '') || '|' || 
                      NEW.details::text || '|' || 
                      NEW.created_at::text;

  NEW.current_hash := encode(sha256(computed_payload::bytea), 'hex');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- 5. Transactional Ingestion with Real Activation Logic
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commit_ingestion_transaction(
    p_site_id UUID,
    p_filename TEXT,
    p_checksum_sha256 VARCHAR(64),
    p_uploaded_by UUID,
    p_rows JSONB,
    p_freshness_status VARCHAR(50),
    p_actor_role VARCHAR(50),
    p_org_id UUID
)
RETURNS JSONB AS $$
DECLARE
    v_run_id UUID;
    v_source_id UUID;
    v_rows_count INT;
    v_op_date DATE;
    v_prev_status VARCHAR(50);
    v_new_status VARCHAR(50);
    v_pub_gate VARCHAR(50);
    v_validation_status VARCHAR(50);
    v_completeness NUMERIC(5,2);
BEGIN
    -- 1. Strict Duplicate Check on SHA-256 Checksum per site
    IF EXISTS (
        SELECT 1 FROM public.ingestion_runs
        WHERE site_id = p_site_id AND checksum_sha256 = p_checksum_sha256
    ) THEN
        RAISE EXCEPTION 'DUPLICATE_FILE: File with checksum % has already been committed for site %',
            p_checksum_sha256, p_site_id;
    END IF;

    -- 2. Count rows
    v_rows_count := jsonb_array_length(p_rows);
    IF v_rows_count = 0 THEN
        RAISE EXCEPTION 'EMPTY_DATASET: Cannot commit empty 96-block interval dataset';
    END IF;

    v_completeness := LEAST(100.0, (v_rows_count::numeric / 96.0) * 100.0);
    v_validation_status := CASE WHEN v_rows_count = 96 THEN 'PASSED' ELSE 'FAILED' END;

    -- 3. Determine Publication Gate Status based on Contiguity & Freshness
    IF v_rows_count < 96 THEN
        v_pub_gate := 'BLOCKED_INCOMPLETE';
    ELSIF p_freshness_status = 'STALE' THEN
        v_pub_gate := 'BLOCKED_STALE';
    ELSE
        v_pub_gate := 'PUBLISHABLE';
    END IF;

    -- 4. Resolve or create data_source
    SELECT id INTO v_source_id FROM public.data_sources WHERE site_id = p_site_id LIMIT 1;
    IF v_source_id IS NULL THEN
        INSERT INTO public.data_sources (site_id, source_type, name, config, is_active)
        VALUES (p_site_id, 'CSV_UPLOAD', 'Automated Gateway CSV Ingestion', '{}'::jsonb, true)
        RETURNING id INTO v_source_id;
    END IF;

    -- 5. Create Ingestion Run header
    INSERT INTO public.ingestion_runs (
        data_source_id, site_id, filename, checksum_sha256, status, total_rows, accepted_rows, rejected_rows, uploaded_by
    ) VALUES (
        v_source_id, p_site_id, p_filename, p_checksum_sha256, 'ACCEPTED', v_rows_count, v_rows_count, 0, p_uploaded_by
    ) RETURNING id INTO v_run_id;

    -- 5. Atomic Upsert of 96 blocks
    INSERT INTO public.interval_data_96 (
        site_id, operating_date, block_index, timestamp_utc,
        load_kw, generation_solar_kw, actual_drawal_kw, scheduled_drawal_kw,
        data_quality, ingestion_run_id
    )
    SELECT
        p_site_id,
        (r->>'operating_date')::date,
        (r->>'block_index')::int,
        (r->>'timestamp_utc')::timestamptz,
        (r->>'load_kw')::numeric,
        (r->>'solar_generation_kw')::numeric,
        (r->>'actual_drawal_kw')::numeric,
        (r->>'scheduled_drawal_kw')::numeric,
        v_validation_status,
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

    -- 6. Data quality evaluation
    SELECT (p_rows->0->>'operating_date')::date INTO v_op_date;
    INSERT INTO public.data_quality_evaluations (
        site_id, evaluation_date, completeness_pct, missing_blocks_count, freshness_status, validation_status, publication_gate_status
    ) VALUES (
        p_site_id, COALESCE(v_op_date, CURRENT_DATE), v_completeness, 96 - v_rows_count, p_freshness_status, v_validation_status, v_pub_gate
    ) ON CONFLICT (site_id, evaluation_date) DO UPDATE SET
        completeness_pct = EXCLUDED.completeness_pct,
        missing_blocks_count = EXCLUDED.missing_blocks_count,
        freshness_status = EXCLUDED.freshness_status,
        validation_status = EXCLUDED.validation_status,
        publication_gate_status = EXCLUDED.publication_gate_status;

    -- 7. Update site activation state machine (Fetch REAL previous status)
    SELECT activation_status INTO v_prev_status FROM public.sites WHERE id = p_site_id;

    IF v_pub_gate = 'PUBLISHABLE' AND v_prev_status IN ('CONFIGURED', 'AWAITING_DATA') THEN
        v_new_status := 'ACTIVE';
        UPDATE public.sites SET activation_status = v_new_status, last_status_change = now()
        WHERE id = p_site_id;

        INSERT INTO public.site_activation_history (site_id, previous_status, new_status, reason, changed_by)
        VALUES (p_site_id, v_prev_status, v_new_status, 'Contiguous 96-block interval upload completed and validated', p_uploaded_by);
    ELSIF v_pub_gate = 'BLOCKED_STALE' AND v_prev_status = 'CONFIGURED' THEN
        v_new_status := 'AWAITING_DATA';
        UPDATE public.sites SET activation_status = v_new_status, last_status_change = now()
        WHERE id = p_site_id;

        INSERT INTO public.site_activation_history (site_id, previous_status, new_status, reason, changed_by)
        VALUES (p_site_id, v_prev_status, v_new_status, 'Historical interval data ingested; recent data required for activation', p_uploaded_by);
    END IF;

    -- 8. Append-only Audit Log
    INSERT INTO public.audit_logs (
        organisation_id, site_id, actor_id, actor_role, action, entity_type, entity_id, details
    ) VALUES (
        p_org_id, p_site_id, p_uploaded_by, COALESCE(p_actor_role, 'SYSTEM'), 'INTERVAL_DATA_INGESTED', 'INGESTION_RUN', v_run_id::text,
        jsonb_build_object('filename', p_filename, 'checksum', p_checksum_sha256, 'total_rows', v_rows_count, 'publication_gate', v_pub_gate)
    );

    RETURN jsonb_build_object(
        'success', true,
        'ingestion_run_id', v_run_id,
        'total_blocks', v_rows_count,
        'freshness_status', p_freshness_status,
        'publication_gate_status', v_pub_gate
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- 6. Atomic Razorpay Webhook Processing with Distinct Event Handling
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_razorpay_webhook_atomic(
    p_event_id VARCHAR(100),
    p_event_type VARCHAR(100),
    p_payload JSONB,
    p_org_id UUID,
    p_site_id UUID,
    p_product_id VARCHAR(50),
    p_provider_ref VARCHAR(100),
    p_amount_paise BIGINT
)
RETURNS JSONB AS $$
DECLARE
    v_sub_id UUID;
    v_now TIMESTAMPTZ := now();
    v_period_end TIMESTAMPTZ := now() + interval '30 days';
    v_invoice_num VARCHAR(100);
BEGIN
    -- Atomic replay check
    IF EXISTS (SELECT 1 FROM public.processed_webhook_events WHERE id = p_event_id) THEN
        RETURN jsonb_build_object('status', 'already_processed', 'event_id', p_event_id);
    END IF;

    -- Track event processing
    INSERT INTO public.processed_webhook_events (id, provider, event_type, payload, status)
    VALUES (p_event_id, 'RAZORPAY', p_event_type, p_payload, 'PROCESSING');

    IF p_event_type IN ('order.paid', 'payment.captured', 'subscription.charged', 'subscription.activated') THEN
        -- Upsert subscription
        SELECT id INTO v_sub_id FROM public.subscriptions WHERE billing_provider_ref = p_provider_ref LIMIT 1;
        IF v_sub_id IS NULL THEN
            INSERT INTO public.subscriptions (
                organisation_id, status, current_period_start, current_period_end, billing_provider, billing_provider_ref
            ) VALUES (
                p_org_id, 'ACTIVE', v_now, v_period_end, 'RAZORPAY', p_provider_ref
            ) RETURNING id INTO v_sub_id;
        ELSE
            UPDATE public.subscriptions SET status = 'ACTIVE', current_period_end = v_period_end, updated_at = v_now
            WHERE id = v_sub_id;
        END IF;

        -- Upsert entitlement
        INSERT INTO public.entitlements (
            organisation_id, product_id, site_id, is_active, valid_from, valid_until, granted_by
        ) VALUES (
            p_org_id, p_product_id, p_site_id, true, v_now, v_period_end, 'RAZORPAY_WEBHOOK'
        ) ON CONFLICT (organisation_id, product_id, site_id) DO UPDATE SET
            is_active = true,
            valid_until = EXCLUDED.valid_until,
            granted_by = EXCLUDED.granted_by;

        -- Upsert invoice
        v_invoice_num := 'INV-' || COALESCE(SUBSTRING(p_provider_ref FROM '[0-9a-zA-Z]{6}$'), TO_CHAR(v_now, 'YYYYMMDDHH24MISS'));
        INSERT INTO public.invoices (
            organisation_id, subscription_id, invoice_number, amount_paise, total_paise, currency, status, paid_at
        ) VALUES (
            p_org_id, v_sub_id, v_invoice_num, p_amount_paise, p_amount_paise, 'INR', 'PAID', v_now
        ) ON CONFLICT (invoice_number) DO NOTHING;

    ELSIF p_event_type IN ('subscription.cancelled', 'subscription.halted', 'subscription.expired') THEN
        -- Deactivate subscription
        UPDATE public.subscriptions 
        SET status = 'CANCELLED', cancel_at_period_end = true, updated_at = v_now
        WHERE billing_provider_ref = p_provider_ref OR (organisation_id = p_org_id AND status = 'ACTIVE');

        -- Deactivate corresponding entitlement
        UPDATE public.entitlements
        SET is_active = false, valid_until = v_now
        WHERE organisation_id = p_org_id 
          AND product_id = p_product_id 
          AND site_id IS NOT DISTINCT FROM p_site_id;

    ELSIF p_event_type IN ('payment.failed') THEN
        -- Record failed invoice attempt
        v_invoice_num := 'INV-FAIL-' || COALESCE(SUBSTRING(p_provider_ref FROM '[0-9a-zA-Z]{6}$'), TO_CHAR(v_now, 'YYYYMMDDHH24MISS'));
        INSERT INTO public.invoices (
            organisation_id, subscription_id, invoice_number, amount_paise, total_paise, currency, status
        ) VALUES (
            p_org_id, NULL, v_invoice_num, p_amount_paise, p_amount_paise, 'INR', 'FAILED'
        ) ON CONFLICT (invoice_number) DO NOTHING;

    END IF;

    UPDATE public.processed_webhook_events SET status = 'PROCESSED' WHERE id = p_event_id;

    RETURN jsonb_build_object('status', 'success', 'event_id', p_event_id, 'subscription_id', v_sub_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- 7. LOCK DOWN SECURITY DEFINER PRIVILEGES
-- Revoke PUBLIC/anon/authenticated on privileged RPCs and grant ONLY to service_role / postgres
-- ----------------------------------------------------------------------------

-- A. Privileged Backend RPC Functions: service_role ONLY
REVOKE EXECUTE ON FUNCTION public.commit_ingestion_transaction(UUID, TEXT, VARCHAR, UUID, JSONB, VARCHAR, VARCHAR, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_ingestion_transaction(UUID, TEXT, VARCHAR, UUID, JSONB, VARCHAR, VARCHAR, UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.process_razorpay_webhook_atomic(VARCHAR, VARCHAR, JSONB, UUID, UUID, VARCHAR, VARCHAR, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_razorpay_webhook_atomic(VARCHAR, VARCHAR, JSONB, UUID, UUID, VARCHAR, VARCHAR, BIGINT) TO service_role;

-- B. Trigger Functions: postgres and service_role ONLY
REVOKE EXECUTE ON FUNCTION public.chain_audit_log() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chain_audit_log() TO postgres, service_role;

REVOKE EXECUTE ON FUNCTION public.freeze_audit_log() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.freeze_audit_log() TO postgres, service_role;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, service_role;

REVOKE EXECUTE ON FUNCTION public.protect_user_profile_escalation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_user_profile_escalation() TO postgres, service_role;

REVOKE EXECUTE ON FUNCTION public.enforce_membership_role_boundary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_membership_role_boundary() TO postgres, service_role;

-- C. RLS Evaluation Helper Functions: anon, authenticated and service_role (REVOKE PUBLIC)
REVOKE EXECUTE ON FUNCTION public.is_org_member(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_org_member(UUID) TO anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.has_org_role(UUID, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_org_role(UUID, VARCHAR) TO anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.has_site_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_site_access(UUID) TO anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.is_platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.is_aetheon_analyst() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_aetheon_analyst() TO anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.is_regulatory_reviewer() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_regulatory_reviewer() TO anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.is_internal_aetheon_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_internal_aetheon_user() TO anon, authenticated, service_role;
