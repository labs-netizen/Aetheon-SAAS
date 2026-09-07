-- ============================================================================
-- Migration 11: Pre-Astra Functional Blocker Resolution
--
-- 1. Extend report_records schema with storage_path and reconcile canonical fields
-- 2. Enforce write-time Analyst Expiry constraint (NOT NULL, <= 24 hours) in trigger
-- 3. Persist local provider checkout reference mapping for authoritative webhook resolution
-- 4. Audit log hash chaining concurrency lock (pg_advisory_xact_lock per org)
-- 5. Site activation state machine: 1 file moves to CALIBRATING, >=7 days to ACTIVE
-- 6. Compliance obligations table with approval gate for statutory calendar
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Extend report_records schema
-- ----------------------------------------------------------------------------
ALTER TABLE public.report_records ADD COLUMN IF NOT EXISTS storage_path TEXT;

-- ----------------------------------------------------------------------------
-- 2. Enforce write-time Analyst Expiry constraint in memberships trigger
-- ----------------------------------------------------------------------------
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

  -- Write-time enforcement for AETHEON_ANALYST:
  -- Must have non-null expires_at, in the future, and not exceed 24 hours maximum
  IF NEW.role = 'AETHEON_ANALYST' THEN
    IF NEW.expires_at IS NULL THEN
      RAISE EXCEPTION 'SECURITY VIOLATION: AETHEON_ANALYST memberships must specify an explicit expires_at timestamp.';
    END IF;
    IF NEW.expires_at <= now() THEN
      RAISE EXCEPTION 'SECURITY VIOLATION: AETHEON_ANALYST expires_at must be in the future.';
    END IF;
    IF NEW.expires_at > (now() + interval '24 hours 5 minutes') THEN
      RAISE EXCEPTION 'SECURITY VIOLATION: AETHEON_ANALYST access duration cannot exceed 24 hours from current time.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- 3. Local Provider Checkout Reference Mapping (Billing Binding Hardening)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_checkout_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_reference VARCHAR(255) NOT NULL UNIQUE,
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    product_id VARCHAR(50) NOT NULL REFERENCES products(id),
    amount_paise BIGINT NOT NULL,
    provider_mode VARCHAR(50) NOT NULL, -- 'MOCK_DEVELOPMENT', 'RAZORPAY_TEST', 'RAZORPAY_LIVE'
    status VARCHAR(50) NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED', 'PAID', 'CANCELLED', 'EXPIRED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.billing_checkout_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins and service role manage billing checkout sessions"
    ON public.billing_checkout_sessions
    FOR ALL
    USING (public.is_platform_admin() OR auth.role() = 'service_role' OR CURRENT_USER = 'postgres')
    WITH CHECK (public.is_platform_admin() OR auth.role() = 'service_role' OR CURRENT_USER = 'postgres');

CREATE POLICY "Org members can view their own checkout sessions"
    ON public.billing_checkout_sessions
    FOR SELECT
    USING (public.is_org_member(organisation_id));

GRANT SELECT, INSERT, UPDATE ON public.billing_checkout_sessions TO service_role, postgres;
GRANT SELECT ON public.billing_checkout_sessions TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. Update Atomic Webhook Processor to enforce Local Provider Reference Binding
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_razorpay_webhook_atomic(
    p_event_id VARCHAR(255),
    p_event_type VARCHAR(100),
    p_payload JSONB,
    p_org_id UUID,
    p_site_id UUID,
    p_product_id VARCHAR(50),
    p_provider_ref VARCHAR(255),
    p_amount_paise BIGINT
)
RETURNS JSONB AS $$
DECLARE
    v_existing_id VARCHAR(255);
    v_sub_id UUID;
    v_now TIMESTAMPTZ := now();
    v_period_end TIMESTAMPTZ := now() + interval '30 days';
    v_invoice_num VARCHAR(100);
    v_resolved_org_id UUID;
    v_resolved_site_id UUID;
    v_resolved_product_id VARCHAR(50);
    v_mapped_amount BIGINT;
    v_normalized_product_id VARCHAR(50);
    v_session RECORD;
BEGIN
    -- 1. Idempotency Gate (Strict serial lock on event_id)
    SELECT id INTO v_existing_id 
    FROM public.processed_webhook_events 
    WHERE id = p_event_id;

    IF v_existing_id IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'already_processed', 'event_id', p_event_id);
    END IF;

    -- 2. Resolve authoritative commercial binding from local checkout mapping
    SELECT organisation_id, site_id, product_id, amount_paise INTO v_session
    FROM public.billing_checkout_sessions
    WHERE provider_reference = p_provider_ref
    LIMIT 1;

    IF v_session.organisation_id IS NOT NULL THEN
        v_resolved_org_id := v_session.organisation_id;
        v_resolved_site_id := v_session.site_id;
        v_resolved_product_id := v_session.product_id;
        v_mapped_amount := v_session.amount_paise;
    ELSE
        -- If no local checkout mapping exists, reject unmapped webhook
        IF p_provider_ref IS NOT NULL AND p_provider_ref NOT LIKE 'order_mock_%' THEN
            RAISE EXCEPTION 'SECURITY ERROR: Unknown provider reference (%). Webhook notes are not authorized without local checkout session.', p_provider_ref;
        END IF;

        -- Fallback for legacy test events with explicit org_id
        IF p_org_id IS NULL THEN
            RAISE EXCEPTION 'SECURITY ERROR: Webhook event missing both valid local provider reference and organisation_id.';
        END IF;
        v_resolved_org_id := p_org_id;
        v_resolved_site_id := p_site_id;
        v_resolved_product_id := p_product_id;
        v_mapped_amount := p_amount_paise;
    END IF;

    -- Canonical product ID normalization
    v_normalized_product_id := CASE 
        WHEN v_resolved_product_id = 'OPEN_ACCESS_COMPLIANCE' THEN 'OA_COMPLIANCE'
        WHEN v_resolved_product_id = 'DSM_MONITOR' THEN 'DSM_RISK'
        ELSE v_resolved_product_id
    END;

    -- 3. Record in processed_webhook_events immediately
    INSERT INTO public.processed_webhook_events (id, provider, event_type, payload)
    VALUES (p_event_id, 'RAZORPAY', p_event_type, p_payload);

    -- Update session status if mapped
    UPDATE public.billing_checkout_sessions
    SET status = 'PAID'
    WHERE provider_reference = p_provider_ref;

    -- 4. Branch by Event Type
    IF p_event_type IN ('payment.captured', 'order.paid', 'subscription.charged', 'subscription.activated') THEN
        -- Upsert subscription
        SELECT id INTO v_sub_id FROM public.subscriptions 
        WHERE organisation_id = v_resolved_org_id AND billing_provider_ref = p_provider_ref
        LIMIT 1;

        IF v_sub_id IS NULL THEN
            INSERT INTO public.subscriptions (
                organisation_id, status, current_period_start, current_period_end, 
                billing_provider, billing_provider_ref
            ) VALUES (
                v_resolved_org_id, 'ACTIVE', v_now, v_period_end,
                'RAZORPAY', p_provider_ref
            ) RETURNING id INTO v_sub_id;
        ELSE
            UPDATE public.subscriptions
            SET status = 'ACTIVE', 
                current_period_end = v_period_end,
                updated_at = v_now
            WHERE id = v_sub_id;
        END IF;

        -- Insert subscription item
        INSERT INTO public.subscription_items (
            subscription_id, product_id, site_id, unit_price_paise, quantity
        ) VALUES (
            v_sub_id, v_normalized_product_id, v_resolved_site_id, v_mapped_amount, 1
        );

        -- Upsert Entitlement
        INSERT INTO public.entitlements (
            organisation_id, product_id, site_id, is_active, valid_from, valid_until, granted_by
        ) VALUES (
            v_resolved_org_id, v_normalized_product_id, v_resolved_site_id, true, v_now, v_period_end, 'RAZORPAY_WEBHOOK'
        ) ON CONFLICT (organisation_id, product_id, site_id) DO UPDATE SET
            is_active = true,
            valid_until = EXCLUDED.valid_until,
            granted_by = EXCLUDED.granted_by;

        -- Create Paid Invoice Record
        v_invoice_num := 'INV-' || COALESCE(SUBSTRING(p_provider_ref FROM '[0-9a-zA-Z]{6}$'), TO_CHAR(v_now, 'YYYYMMDDHH24MISS'));
        INSERT INTO public.invoices (
            organisation_id, subscription_id, invoice_number, amount_paise, total_paise,
            currency, status, paid_at
        ) VALUES (
            v_resolved_org_id, v_sub_id, v_invoice_num,
            v_mapped_amount, v_mapped_amount, 'INR', 'PAID', v_now
        ) ON CONFLICT (invoice_number) DO NOTHING;

    ELSIF p_event_type IN ('subscription.cancelled', 'subscription.halted', 'subscription.expired', 'subscription.paused') THEN
        UPDATE public.subscriptions
        SET status = 'CANCELLED', cancel_at_period_end = true, updated_at = v_now
        WHERE organisation_id = v_resolved_org_id 
          AND (billing_provider_ref = p_provider_ref OR id::text = p_provider_ref);

        UPDATE public.entitlements
        SET is_active = false, valid_until = v_now
        WHERE organisation_id = v_resolved_org_id 
          AND product_id = v_normalized_product_id
          AND site_id IS NOT DISTINCT FROM v_resolved_site_id;

    ELSIF p_event_type IN ('payment.failed') THEN
        UPDATE public.subscriptions
        SET status = 'PAST_DUE', updated_at = v_now
        WHERE organisation_id = v_resolved_org_id AND billing_provider_ref = p_provider_ref;

        v_invoice_num := 'INV-FAIL-' || COALESCE(SUBSTRING(p_provider_ref FROM '[0-9a-zA-Z]{6}$'), TO_CHAR(v_now, 'YYYYMMDDHH24MISS'));
        INSERT INTO public.invoices (
            organisation_id, subscription_id, invoice_number, amount_paise, total_paise,
            currency, status
        ) VALUES (
            v_resolved_org_id, NULL, v_invoice_num,
            v_mapped_amount, v_mapped_amount, 'INR', 'FAILED'
        ) ON CONFLICT (invoice_number) DO NOTHING;
    END IF;

    RETURN jsonb_build_object(
        'status', 'success',
        'event_id', p_event_id,
        'org_id', v_resolved_org_id,
        'product_id', v_normalized_product_id,
        'site_id', v_resolved_site_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- 5. Audit Hash Chain Concurrency Lock
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

  -- Acquire transactional advisory lock per organisation to serialize concurrent audit inserts without forks
  PERFORM pg_advisory_xact_lock(hashtext(COALESCE(NEW.organisation_id::text, 'GLOBAL_AUDIT_CHAIN')));

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
-- 6. Site Activation State Machine (Do NOT activate site after 1 file)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commit_ingestion_transaction(
    p_site_id UUID,
    p_filename TEXT,
    p_checksum_sha256 VARCHAR(64),
    p_uploaded_by UUID,
    p_rows JSONB,
    p_freshness_status VARCHAR(50),
    p_model_version VARCHAR(50) DEFAULT 'GATEWAY_RAW_v1.0'
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
    v_days_count INT;
    v_reason TEXT;
BEGIN
    -- 1. Security Check: Caller must be service_role or postgres
    IF current_setting('role', true) != 'service_role' AND CURRENT_USER != 'postgres' THEN
        RAISE EXCEPTION 'PERMISSION DENIED: Ingestion transactions can only be committed by backend service-role.';
    END IF;

    -- 2. Row count & completeness evaluation
    v_rows_count := jsonb_array_length(p_rows);
    IF v_rows_count = 0 THEN
        RAISE EXCEPTION 'INGESTION_ERROR: Payload contains 0 interval blocks.';
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

    -- 6. Atomic Upsert of 96 blocks
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

    -- 7. Data quality evaluation
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

    -- 8. Update site activation state machine
    -- Specification requirement: A single file upload does NOT jump straight to ACTIVE.
    -- First valid data moves CONFIGURED / AWAITING_DATA to CALIBRATING.
    -- Site only transitions to ACTIVE when >= 7 distinct operating days are available and fresh.
    SELECT activation_status INTO v_prev_status FROM public.sites WHERE id = p_site_id;
    
    SELECT COUNT(DISTINCT operating_date) INTO v_days_count
    FROM public.interval_data_96
    WHERE site_id = p_site_id;

    IF v_pub_gate = 'PUBLISHABLE' THEN
        IF v_days_count >= 7 AND p_freshness_status = 'RECENT' THEN
            v_new_status := 'ACTIVE';
            v_reason := 'Operational calibration complete with ' || v_days_count || ' days of interval data';
        ELSE
            v_new_status := 'CALIBRATING';
            v_reason := 'Interval data received (' || v_days_count || ' day(s)). Model calibration in progress (7 days required for ACTIVE)';
        END IF;

        IF v_new_status IS DISTINCT FROM v_prev_status THEN
            UPDATE public.sites 
            SET activation_status = v_new_status, last_status_change = now()
            WHERE id = p_site_id;

            INSERT INTO public.site_activation_history (site_id, previous_status, new_status, reason, changed_by)
            VALUES (p_site_id, v_prev_status, v_new_status, v_reason, p_uploaded_by);
        END IF;
    ELSIF v_pub_gate = 'BLOCKED_STALE' THEN
        IF v_prev_status = 'ACTIVE' THEN
            v_new_status := 'DEGRADED';
            v_reason := 'Data pipeline stale (>24 hours). Operational status degraded.';
            UPDATE public.sites SET activation_status = v_new_status, last_status_change = now() WHERE id = p_site_id;
            INSERT INTO public.site_activation_history (site_id, previous_status, new_status, reason, changed_by)
            VALUES (p_site_id, v_prev_status, v_new_status, v_reason, p_uploaded_by);
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'run_id', v_run_id,
        'site_id', p_site_id,
        'rows_ingested', v_rows_count,
        'completeness_pct', v_completeness,
        'publication_gate_status', v_pub_gate,
        'validation_status', v_validation_status,
        'activation_status', COALESCE(v_new_status, v_prev_status)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- 7. Compliance Obligations Table (Statutory Compliance Calendar)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compliance_obligations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    regulatory_source_id UUID REFERENCES regulatory_sources(id),
    jurisdiction VARCHAR(100) NOT NULL,
    state VARCHAR(100),
    discom VARCHAR(100),
    obligation_title VARCHAR(255) NOT NULL,
    obligation_type VARCHAR(100) NOT NULL, -- 'DISCOM Filing', 'SLDC Statutory', 'Regulatory Compliance'
    deadline_date DATE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED')),
    owner_role VARCHAR(50) NOT NULL DEFAULT 'ENERGY_MANAGER',
    is_demo BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.compliance_obligations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers view approved compliance obligations"
    ON public.compliance_obligations
    FOR SELECT
    USING (
        (regulatory_source_id IS NULL OR EXISTS (
            SELECT 1 FROM regulatory_sources rs 
            WHERE rs.id = compliance_obligations.regulatory_source_id 
              AND rs.status IN ('APPROVED', 'PUBLISHED')
        ))
        OR public.is_internal_aetheon_user()
    );

CREATE POLICY "Internal reviewers manage compliance obligations"
    ON public.compliance_obligations
    FOR ALL
    USING (public.is_regulatory_reviewer())
    WITH CHECK (public.is_regulatory_reviewer());

GRANT SELECT ON public.compliance_obligations TO authenticated, anon;
GRANT ALL ON public.compliance_obligations TO service_role, postgres;
