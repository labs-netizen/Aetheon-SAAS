-- ============================================================================
-- Migration 12: Final RLS Policy Cleanup, Canonical Ingestion RPC & Consistency
-- Description:
--   1. Drop obsolete commit_ingestion_transaction overloads; establish single
--      canonical 8-arg signature with CALIBRATING state machine and service_role grant.
--   2. Purge all surviving permissive legacy RLS policies from pg_policies.
--   3. Enforce server-only writes on interval_data_96, ingestion_runs, audit_logs,
--      site_activation_history, and report_records.
--   4. Restrict billing_checkout_sessions to ORGANISATION_ADMIN and FINANCE_SUSTAINABILITY_VIEWER.
--   5. Support 'FAILED' in invoices and billing_checkout_sessions status checks.
--   6. Prevent duplicate subscription_items via unique index and idempotent webhook upsert.
--   7. Ensure deterministic unique window on dsm_incidents for idempotent recalculation.
--   8. Seed verified CEA emission factors.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Canonical Ingestion Transaction RPC
-- ----------------------------------------------------------------------------
-- Drop all conflicting historical signatures
DROP FUNCTION IF EXISTS public.commit_ingestion_transaction(UUID, TEXT, VARCHAR, UUID, JSONB, VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS public.commit_ingestion_transaction(UUID, TEXT, VARCHAR, UUID, JSONB, VARCHAR, VARCHAR, UUID);

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
    v_days_count INT;
    v_reason TEXT;
BEGIN
    -- 1. Security Check: Caller must be service_role or postgres
    IF current_setting('role', true) != 'service_role' AND CURRENT_USER != 'postgres' THEN
        RAISE EXCEPTION 'PERMISSION DENIED: Ingestion transactions can only be committed by backend service-role.';
    END IF;

    -- 2. Check for duplicate SHA-256 hash per site
    IF EXISTS (
        SELECT 1 FROM public.ingestion_runs
        WHERE site_id = p_site_id AND checksum_sha256 = p_checksum_sha256
    ) THEN
        RAISE EXCEPTION 'DUPLICATE_FILE: File with checksum % has already been committed for site %',
            p_checksum_sha256, p_site_id;
    END IF;

    -- 3. Row count & completeness evaluation (Minimum 95.0% completeness required)
    v_rows_count := jsonb_array_length(p_rows);
    IF v_rows_count = 0 THEN
        RAISE EXCEPTION 'INGESTION_ERROR: Payload contains 0 interval blocks.';
    END IF;

    v_completeness := LEAST(100.0, (v_rows_count::numeric / 96.0) * 100.0);
    v_validation_status := CASE WHEN v_rows_count = 96 THEN 'PASSED' ELSE 'FAILED' END;

    -- 4. Determine Publication Gate Status based on Contiguity & Freshness
    IF v_completeness < 95.0 THEN
        v_pub_gate := 'BLOCKED_INCOMPLETE';
    ELSIF p_freshness_status = 'STALE' THEN
        v_pub_gate := 'BLOCKED_STALE';
    ELSE
        v_pub_gate := 'PUBLISHABLE';
    END IF;

    -- 5. Resolve or create data_source
    SELECT id INTO v_source_id FROM public.data_sources WHERE site_id = p_site_id LIMIT 1;
    IF v_source_id IS NULL THEN
        INSERT INTO public.data_sources (site_id, source_type, name, config, is_active)
        VALUES (p_site_id, 'CSV_UPLOAD', 'Automated Gateway CSV Ingestion', '{}'::jsonb, true)
        RETURNING id INTO v_source_id;
    END IF;

    -- 6. Create Ingestion Run header
    INSERT INTO public.ingestion_runs (
        data_source_id, site_id, filename, checksum_sha256, status, total_rows, accepted_rows, rejected_rows, uploaded_by
    ) VALUES (
        v_source_id, p_site_id, p_filename, p_checksum_sha256, 'ACCEPTED', v_rows_count, v_rows_count, 0, p_uploaded_by
    ) RETURNING id INTO v_run_id;

    -- 7. Atomic Upsert of 96 blocks
    INSERT INTO public.interval_data_96 (
        site_id, operating_date, block_index, timestamp_utc,
        load_kw, generation_solar_kw, actual_drawal_kw, scheduled_drawal_kw,
        data_quality, ingestion_run_id
    )
    SELECT
        p_site_id,
        (r->>'operating_date')::date,
        (r->>'block_index')::int,
        COALESCE(
            (r->>'timestamp_utc')::timestamptz,
            ((r->>'operating_date')::date + ((r->>'block_index')::integer - 1) * INTERVAL '15 minutes') AT TIME ZONE 'Asia/Kolkata'
        ),
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

    -- 8. Data quality evaluation
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

    -- 9. Update site activation state machine
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

    -- 10. Audit log for ingestion commit
    INSERT INTO public.audit_logs (
        organisation_id, site_id, actor_id, actor_role, action, entity_type, entity_id, details
    ) VALUES (
        p_org_id, p_site_id, p_uploaded_by, p_actor_role, 'INGESTION_COMMITTED', 'INGESTION_RUN', v_run_id::text,
        jsonb_build_object(
            'filename', p_filename,
            'checksum', p_checksum_sha256,
            'rows_count', v_rows_count,
            'publication_gate_status', v_pub_gate,
            'activation_status', COALESCE(v_new_status, v_prev_status)
        )
    );

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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.commit_ingestion_transaction(UUID, TEXT, VARCHAR, UUID, JSONB, VARCHAR, VARCHAR, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_ingestion_transaction(UUID, TEXT, VARCHAR, UUID, JSONB, VARCHAR, VARCHAR, UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- 2. Purge Stale Permissive RLS Policies & Enforce Correct Boundaries
-- ----------------------------------------------------------------------------

-- Subscriptions: only Org Admins and Finance Viewers
DROP POLICY IF EXISTS "Members can view subscriptions" ON public.subscriptions;

-- Invoices: only Org Admins and Finance Viewers
DROP POLICY IF EXISTS "Members can view invoices" ON public.invoices;

-- Report Records: Site-level SELECT; Server-only INSERT/UPDATE
DROP POLICY IF EXISTS "Members can view reports" ON public.report_records;
DROP POLICY IF EXISTS "Managers can generate reports" ON public.report_records;
DROP POLICY IF EXISTS "Server only insert report records" ON public.report_records;
DROP POLICY IF EXISTS "Users can view reports for permitted sites or org-wide" ON public.report_records;

CREATE POLICY "Users can view reports for permitted sites or org-wide"
    ON public.report_records FOR SELECT
    USING (
        public.has_site_access(site_id) OR
        (site_id IS NULL AND public.is_org_member(organisation_id)) OR
        public.is_platform_admin()
    );

CREATE POLICY "Server only write report records"
    ON public.report_records FOR ALL
    USING (public.is_platform_admin() OR (auth.role() = 'service_role') OR (CURRENT_USER = 'postgres'))
    WITH CHECK (public.is_platform_admin() OR (auth.role() = 'service_role') OR (CURRENT_USER = 'postgres'));

-- Audit Logs: Server-only INSERT
DROP POLICY IF EXISTS "System and users can insert audit records" ON public.audit_logs;
CREATE POLICY "Server only insert audit records"
    ON public.audit_logs FOR INSERT
    WITH CHECK (public.is_platform_admin() OR (auth.role() = 'service_role') OR (CURRENT_USER = 'postgres'));

-- Ingestion Runs: Server-only INSERT
DROP POLICY IF EXISTS "Energy Managers and Org Admins can insert ingestion runs" ON public.ingestion_runs;
CREATE POLICY "Server only write ingestion runs"
    ON public.ingestion_runs FOR ALL
    USING (public.is_platform_admin() OR (auth.role() = 'service_role') OR (CURRENT_USER = 'postgres'))
    WITH CHECK (public.is_platform_admin() OR (auth.role() = 'service_role') OR (CURRENT_USER = 'postgres'));

-- Interval Data: Server-only INSERT/UPDATE/DELETE
DROP POLICY IF EXISTS "Energy Managers and Org Admins can insert interval data for per" ON public.interval_data_96;
CREATE POLICY "Server only write interval data"
    ON public.interval_data_96 FOR ALL
    USING (public.is_platform_admin() OR (auth.role() = 'service_role') OR (CURRENT_USER = 'postgres'))
    WITH CHECK (public.is_platform_admin() OR (auth.role() = 'service_role') OR (CURRENT_USER = 'postgres'));

-- Site Activation History: Server-only INSERT
DROP POLICY IF EXISTS "Managers can insert activation history" ON public.site_activation_history;
DROP POLICY IF EXISTS "Members can view activation history" ON public.site_activation_history;
CREATE POLICY "Server only write activation history"
    ON public.site_activation_history FOR ALL
    USING (public.is_platform_admin() OR (auth.role() = 'service_role') OR (CURRENT_USER = 'postgres'))
    WITH CHECK (public.is_platform_admin() OR (auth.role() = 'service_role') OR (CURRENT_USER = 'postgres'));

CREATE POLICY "Users can view activation history for permitted sites"
    ON public.site_activation_history FOR SELECT
    USING (
        public.has_site_access(site_id) OR
        public.is_platform_admin()
    );

-- BESS Signal Runs: Server-only write
DROP POLICY IF EXISTS "Members can insert bess signal runs" ON public.bess_signal_runs;

-- Duplicate management policies cleanup
DROP POLICY IF EXISTS "Members can view site access" ON public.site_access;
DROP POLICY IF EXISTS "Users can view site access for their org" ON public.site_access;
DROP POLICY IF EXISTS "Managers can modify bess assets" ON public.bess_assets;
DROP POLICY IF EXISTS "Managers can modify renewable assets" ON public.renewable_assets;
DROP POLICY IF EXISTS "Operators and managers can update dsm incidents" ON public.dsm_incidents;

-- Billing Checkout Sessions: Restricted to Org Admins and Finance Viewers
DROP POLICY IF EXISTS "Org members can view their own checkout sessions" ON public.billing_checkout_sessions;
CREATE POLICY "Org Admins and Finance Viewers view checkout sessions"
    ON public.billing_checkout_sessions FOR SELECT
    USING (
        public.has_org_role(organisation_id, 'ORGANISATION_ADMIN') OR
        public.has_org_role(organisation_id, 'FINANCE_SUSTAINABILITY_VIEWER') OR
        public.is_platform_admin()
    );

-- Notification Logs: Restrict to relevant roles/site scope
DROP POLICY IF EXISTS "Members can view notification logs" ON public.notification_logs;
CREATE POLICY "Org Admins and Finance Viewers view notification logs"
    ON public.notification_logs FOR SELECT
    USING (
        public.has_org_role(organisation_id, 'ORGANISATION_ADMIN') OR
        public.has_org_role(organisation_id, 'FINANCE_SUSTAINABILITY_VIEWER') OR
        public.is_platform_admin()
    );
CREATE POLICY "Recipients can view their own notification logs"
    ON public.notification_logs FOR SELECT
    USING (
        recipient_email = (SELECT email FROM auth.users WHERE id = auth_user_id())
    );

-- ----------------------------------------------------------------------------
-- 3. Billing Status Reconciliations ('FAILED' Support)
-- ----------------------------------------------------------------------------
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_status_check 
    CHECK (status IN ('DRAFT', 'OPEN', 'PAID', 'UNCOLLECTIBLE', 'VOID', 'FAILED'));

ALTER TABLE public.billing_checkout_sessions DROP CONSTRAINT IF EXISTS billing_checkout_sessions_status_check;
ALTER TABLE public.billing_checkout_sessions ADD CONSTRAINT billing_checkout_sessions_status_check 
    CHECK (status IN ('CREATED', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED'));

-- Prevent duplicate subscription items
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_items_unique 
    ON public.subscription_items (subscription_id, product_id, COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Idempotent DSM Incidents Window
CREATE UNIQUE INDEX IF NOT EXISTS idx_dsm_incidents_unique_window 
    ON public.dsm_incidents (site_id, operating_date, start_block, end_block);

-- ----------------------------------------------------------------------------
-- 4. Atomic Webhook RPC Hardening (Event-Specific Checkout Status)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.process_razorpay_webhook_atomic(varchar, varchar, jsonb, uuid, uuid, varchar, varchar, bigint);
DROP FUNCTION IF EXISTS public.process_razorpay_webhook_atomic;

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
    v_subscription_id UUID;
    v_invoice_number VARCHAR(100);
    v_checkout_session RECORD;
    v_target_org_id UUID;
    v_target_site_id UUID;
    v_target_product_id VARCHAR(50);
BEGIN
    -- 1. Security Check: Only service_role or postgres
    IF current_setting('role', true) != 'service_role' AND CURRENT_USER != 'postgres' THEN
        RAISE EXCEPTION 'PERMISSION DENIED: Webhook processing is restricted to service-role.';
    END IF;

    -- 2. Idempotency Check via processed_webhook_events
    IF EXISTS (SELECT 1 FROM public.processed_webhook_events WHERE id = p_event_id) THEN
        RETURN jsonb_build_object(
            'success', true,
            'idempotent_replay', true,
            'message', 'Webhook event ' || p_event_id || ' already processed.'
        );
    END IF;

    -- 3. Resolve and verify authoritative local provider reference
    IF p_provider_ref IS NOT NULL THEN
        SELECT * INTO v_checkout_session 
        FROM public.billing_checkout_sessions 
        WHERE provider_reference = p_provider_ref 
        LIMIT 1;

        IF FOUND THEN
            v_target_org_id := v_checkout_session.organisation_id;
            v_target_site_id := v_checkout_session.site_id;
            v_target_product_id := v_checkout_session.product_id;
        ELSE
            IF p_provider_ref NOT LIKE 'order_mock_%' THEN
                INSERT INTO public.processed_webhook_events (id, provider, event_type, payload, status)
                VALUES (p_event_id, 'RAZORPAY', p_event_type, p_payload, 'QUARANTINED')
                ON CONFLICT (id) DO NOTHING;

                RAISE EXCEPTION 'SECURITY ERROR: Unknown provider reference (%). Webhook notes are not authorized without local checkout session.', p_provider_ref;
            END IF;
        END IF;
    END IF;

    -- Fallback for test mock references or explicit org_id
    v_target_org_id := COALESCE(v_target_org_id, p_org_id);
    v_target_site_id := COALESCE(v_target_site_id, p_site_id);
    v_target_product_id := COALESCE(v_target_product_id, p_product_id);

    IF v_target_org_id IS NULL THEN
        INSERT INTO public.processed_webhook_events (id, provider, event_type, payload, status)
        VALUES (p_event_id, 'RAZORPAY', p_event_type, p_payload, 'QUARANTINED')
        ON CONFLICT (id) DO NOTHING;
        
        RAISE EXCEPTION 'SECURITY ERROR: Unknown provider reference without local checkout session.';
    END IF;

    -- 4. Insert processed event header
    INSERT INTO public.processed_webhook_events (id, provider, event_type, payload, status)
    VALUES (p_event_id, 'RAZORPAY', p_event_type, p_payload, 'PROCESSED')
    ON CONFLICT (id) DO NOTHING;

    -- 5. Branch on event type and update checkout session status accurately
    IF p_event_type IN ('payment.captured', 'subscription.charged', 'order.paid') THEN
        IF v_checkout_session.id IS NOT NULL THEN
            UPDATE public.billing_checkout_sessions SET status = 'PAID' WHERE id = v_checkout_session.id;
        END IF;

        -- Resolve or create active subscription
        SELECT id INTO v_subscription_id 
        FROM public.subscriptions 
        WHERE organisation_id = v_target_org_id AND status = 'ACTIVE'
        LIMIT 1;

        IF v_subscription_id IS NULL THEN
            INSERT INTO public.subscriptions (
                organisation_id, billing_provider, provider_subscription_id,
                status, current_period_start, current_period_end, amount_paise
            ) VALUES (
                v_target_org_id, 'RAZORPAY', COALESCE(p_provider_ref, 'sub_prov_' || substr(p_event_id, 1, 12)),
                'ACTIVE', now(), now() + interval '30 days', p_amount_paise
            ) RETURNING id INTO v_subscription_id;
        END IF;

        -- Idempotent upsert of subscription item
        INSERT INTO public.subscription_items (subscription_id, product_id, site_id, unit_price_paise, quantity)
        VALUES (v_subscription_id, v_target_product_id, v_target_site_id, p_amount_paise, 1)
        ON CONFLICT (subscription_id, product_id, COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::uuid))
        DO UPDATE SET unit_price_paise = EXCLUDED.unit_price_paise, quantity = EXCLUDED.quantity;

        -- Grant / update entitlement
        INSERT INTO public.entitlements (organisation_id, product_id, site_id, is_active, valid_from, valid_until, granted_by)
        VALUES (v_target_org_id, v_target_product_id, v_target_site_id, true, now(), now() + interval '30 days', 'RAZORPAY_WEBHOOK')
        ON CONFLICT ON CONSTRAINT uq_entitlements_org_product_site
        DO UPDATE SET is_active = true, valid_until = EXCLUDED.valid_until, granted_by = EXCLUDED.granted_by;

        -- Record paid invoice
        v_invoice_number := 'INV-' || to_char(now(), 'YYYYMMDD') || '-' || substr(p_event_id, 1, 8);
        INSERT INTO public.invoices (
            organisation_id, subscription_id, invoice_number, amount_paise, tax_paise, total_paise, status, paid_at
        ) VALUES (
            v_target_org_id, v_subscription_id, v_invoice_number, p_amount_paise, 0, p_amount_paise, 'PAID', now()
        ) ON CONFLICT (invoice_number) DO NOTHING;

    ELSIF p_event_type = 'payment.failed' THEN
        IF v_checkout_session.id IS NOT NULL THEN
            UPDATE public.billing_checkout_sessions SET status = 'FAILED' WHERE id = v_checkout_session.id;
        END IF;

        v_invoice_number := 'INV-FAIL-' || to_char(now(), 'YYYYMMDD') || '-' || substr(p_event_id, 1, 8);
        INSERT INTO public.invoices (
            organisation_id, invoice_number, amount_paise, tax_paise, total_paise, status
        ) VALUES (
            v_target_org_id, v_invoice_number, p_amount_paise, 0, p_amount_paise, 'FAILED'
        ) ON CONFLICT (invoice_number) DO NOTHING;

    ELSIF p_event_type = 'subscription.cancelled' THEN
        IF v_checkout_session.id IS NOT NULL THEN
            UPDATE public.billing_checkout_sessions SET status = 'CANCELLED' WHERE id = v_checkout_session.id;
        END IF;
        UPDATE public.subscriptions SET status = 'CANCELLED', cancelled_at = now() 
        WHERE organisation_id = v_target_org_id AND status = 'ACTIVE';

    ELSIF p_event_type = 'subscription.expired' THEN
        IF v_checkout_session.id IS NOT NULL THEN
            UPDATE public.billing_checkout_sessions SET status = 'EXPIRED' WHERE id = v_checkout_session.id;
        END IF;
        UPDATE public.subscriptions SET status = 'EXPIRED' 
        WHERE organisation_id = v_target_org_id AND status = 'ACTIVE';
    END IF;

    -- 6. Audit log
    INSERT INTO public.audit_logs (
        organisation_id, actor_role, action, entity_type, entity_id, details
    ) VALUES (
        v_target_org_id, 'SYSTEM', 'WEBHOOK_PROCESSED', 'BILLING_EVENT', p_event_id,
        jsonb_build_object(
            'event_type', p_event_type,
            'product_id', v_target_product_id,
            'site_id', v_target_site_id,
            'amount_paise', p_amount_paise
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'event_id', p_event_id,
        'event_type', p_event_type,
        'organisation_id', v_target_org_id,
        'product_id', v_target_product_id,
        'status', 'PROCESSED'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.process_razorpay_webhook_atomic(VARCHAR, VARCHAR, JSONB, UUID, UUID, VARCHAR, VARCHAR, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_razorpay_webhook_atomic(VARCHAR, VARCHAR, JSONB, UUID, UUID, VARCHAR, VARCHAR, BIGINT) TO service_role;

-- ----------------------------------------------------------------------------
-- 5. Seed Verified National CEA Emission Factor
-- ----------------------------------------------------------------------------
INSERT INTO public.emission_factors (
    jurisdiction, factor_value_tco2e_per_mwh, source_name, source_version, effective_year, is_verified
) VALUES (
    'National', 0.716, 'Central Electricity Authority (CEA) CO2 Baseline Database', 'v19.0', 2026, true
) ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- 6. Site-Level Storage Isolation & CSV-Only Telemetry Policy
-- ----------------------------------------------------------------------------
UPDATE storage.buckets
SET allowed_mime_types = ARRAY['text/csv']
WHERE id = 'tenant-uploads';

DO $$
BEGIN
    DROP POLICY IF EXISTS "Tenant users can view their organisation storage objects" ON storage.objects;
    CREATE POLICY "Tenant users can view their organisation storage objects" ON storage.objects FOR SELECT USING (
        bucket_id IN ('tenant-uploads', 'tenant-reports', 'tenant-bills', 'compliance-evidence') AND
        (
            public.is_platform_admin() OR
            public.is_aetheon_analyst() OR
            EXISTS (
                SELECT 1 FROM public.memberships m
                WHERE name LIKE 'tenants/' || m.organisation_id::text || '/%'
                AND (
                    -- If path contains a site_id: tenants/{org_id}/{site_id}/...
                    (split_part(name, '/', 3) ~ '^[0-9a-fA-F-]{36}$' AND (
                        m.role = 'ORGANISATION_ADMIN' OR
                        public.has_site_access(split_part(name, '/', 3)::uuid)
                    ))
                    OR
                    -- If path does not specify a site_id or is an org-level document
                    NOT (split_part(name, '/', 3) ~ '^[0-9a-fA-F-]{36}$')
                )
            )
        )
    );
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Storage policy update notice: %', SQLERRM;
END $$;

-- ----------------------------------------------------------------------------
-- 7. Audit Verification Helper for Ingestion RPC Overload
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_commit_ingestion_transaction_signatures()
RETURNS TABLE (proname name, pronargs smallint) AS $$
BEGIN
    RETURN QUERY
    SELECT p.proname, p.pronargs
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE p.proname = 'commit_ingestion_transaction'
    AND n.nspname = 'public';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.get_commit_ingestion_transaction_signatures() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_commit_ingestion_transaction_signatures() TO service_role, postgres;


