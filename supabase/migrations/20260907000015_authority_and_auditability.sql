-- Aetheon Energy Intelligence Platform - Migration 15: Authority & Auditability
-- 1. Adds regulatory_domain to regulatory_sources for unambiguous rule scoping.
-- 2. Restores atomic site_activation_history recording and last_status_change timestamps in commit_ingestion_transaction.
-- 3. Ensures status idempotency prevents duplicate history spam when status does not transition.

-- 1. Add regulatory_domain to regulatory_sources
ALTER TABLE IF EXISTS public.regulatory_sources 
ADD COLUMN IF NOT EXISTS regulatory_domain VARCHAR(50) DEFAULT 'TARIFF';

UPDATE public.regulatory_sources 
SET regulatory_domain = 'DSM' 
WHERE jurisdiction = 'CERC' OR document_title ILIKE '%DSM%';

UPDATE public.regulatory_sources 
SET regulatory_domain = 'OPEN_ACCESS' 
WHERE document_title ILIKE '%Open Access%';

UPDATE public.regulatory_sources 
SET regulatory_domain = 'TARIFF' 
WHERE regulatory_domain IS NULL;

ALTER TABLE public.regulatory_sources 
ALTER COLUMN regulatory_domain SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reg_sources_domain ON public.regulatory_sources(jurisdiction, regulatory_domain, status);

-- Allow NULL rule_version in dsm_evaluation_runs when no approved rule is resolved
ALTER TABLE IF EXISTS public.dsm_evaluation_runs ALTER COLUMN rule_version DROP NOT NULL;

-- 2. Reconcile products table availability_status check constraint
ALTER TABLE IF EXISTS public.products DROP CONSTRAINT IF EXISTS products_availability_status_check;
ALTER TABLE IF EXISTS public.products ADD CONSTRAINT products_availability_status_check 
    CHECK (availability_status IN ('DEVELOPMENT', 'DEMO', 'INTERNAL_VALIDATION', 'SPECIALIST_REVIEW_REQUIRED', 'AVAILABLE', 'DEGRADED', 'RETIRED'));

-- 3. Canonical commit_ingestion_transaction with atomic activation history
DROP FUNCTION IF EXISTS public.commit_ingestion_transaction(UUID, TEXT, VARCHAR, UUID, JSONB, VARCHAR, VARCHAR, UUID);

CREATE OR REPLACE FUNCTION public.commit_ingestion_transaction(
    p_site_id UUID,
    p_filename TEXT,
    p_checksum_sha256 VARCHAR(64),
    p_uploaded_by UUID,
    p_rows JSONB,
    p_freshness_status VARCHAR(50) DEFAULT 'RECENT',
    p_actor_role VARCHAR(50) DEFAULT 'ENERGY_MANAGER',
    p_org_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_org_id UUID;
    v_source_id UUID;
    v_run_id UUID;
    v_rows_count INTEGER;
    v_distinct_dates INTEGER;
    v_min_block INTEGER;
    v_max_block INTEGER;
    v_distinct_blocks INTEGER;
    v_op_date DATE;
    v_completeness NUMERIC(5, 2);
    v_validation_status VARCHAR(20);
    v_pub_gate VARCHAR(50);
    v_prev_status VARCHAR(50);
    v_new_status VARCHAR(50);
    v_reason TEXT;
    v_days_count INTEGER;
BEGIN
    -- Resolve organisation_id if not provided
    IF p_org_id IS NULL THEN
        SELECT organisation_id INTO v_org_id FROM public.sites WHERE id = p_site_id;
    ELSE
        v_org_id := p_org_id;
    END IF;

    -- SHA-256 Idempotency: Reject duplicate committed files
    IF EXISTS (
        SELECT 1 FROM public.ingestion_runs
        WHERE site_id = p_site_id 
          AND checksum_sha256 = p_checksum_sha256 
          AND status = 'ACCEPTED'
    ) THEN
        RAISE EXCEPTION 'DUPLICATE_FILE: File with checksum % has already been committed for site %',
            p_checksum_sha256, p_site_id;
    END IF;

    -- Exact V1 Contract: Exactly 96 interval blocks required
    v_rows_count := jsonb_array_length(p_rows);
    IF v_rows_count != 96 THEN
        RAISE EXCEPTION 'INGESTION_CONTRACT_VIOLATION: Payload must contain EXACTLY 96 interval blocks (received %).', v_rows_count;
    END IF;

    -- Single operating date and block indices 1 to 96 exactly once
    SELECT 
        COUNT(DISTINCT (r->>'operating_date')),
        MIN((r->>'block_index')::int),
        MAX((r->>'block_index')::int),
        COUNT(DISTINCT (r->>'block_index')::int),
        MIN((r->>'operating_date')::date)
    INTO 
        v_distinct_dates,
        v_min_block,
        v_max_block,
        v_distinct_blocks,
        v_op_date
    FROM jsonb_array_elements(p_rows) AS r;

    IF v_distinct_dates != 1 THEN
        RAISE EXCEPTION 'INGESTION_CONTRACT_VIOLATION: Exactly one operating date permitted per CSV (found %).', v_distinct_dates;
    END IF;

    IF v_distinct_blocks != 96 OR v_min_block != 1 OR v_max_block != 96 THEN
        RAISE EXCEPTION 'INGESTION_CONTRACT_VIOLATION: Blocks must be contiguous 1 to 96 exactly once (min %, max %, unique %).',
            v_min_block, v_max_block, v_distinct_blocks;
    END IF;

    v_completeness := 100.0;
    v_validation_status := 'PASSED';

    -- Determine Publication Gate Status
    -- Invariant: Impossible for validation_status = 'FAILED' AND publication_gate_status = 'PUBLISHABLE'
    IF v_validation_status != 'PASSED' THEN
        v_pub_gate := 'BLOCKED_INVALID_CONFIGURATION';
    ELSIF v_completeness < 95.0 THEN
        v_pub_gate := 'BLOCKED_MISSING_INPUT';
    ELSIF p_freshness_status = 'STALE' THEN
        v_pub_gate := 'BLOCKED_STALE_DATA';
    ELSE
        v_pub_gate := 'PUBLISHABLE';
    END IF;

    -- Resolve or create data_source
    SELECT id INTO v_source_id FROM public.data_sources WHERE site_id = p_site_id LIMIT 1;
    IF v_source_id IS NULL THEN
        INSERT INTO public.data_sources (site_id, source_type, name, config, is_active)
        VALUES (p_site_id, 'CSV_UPLOAD', 'Automated Gateway CSV Ingestion', '{}'::jsonb, true)
        RETURNING id INTO v_source_id;
    END IF;

    -- Create Ingestion Run header
    INSERT INTO public.ingestion_runs (
        data_source_id, site_id, filename, checksum_sha256, status, total_rows, accepted_rows, rejected_rows, uploaded_by
    ) VALUES (
        v_source_id, p_site_id, p_filename, p_checksum_sha256, 'ACCEPTED', v_rows_count, v_rows_count, 0, p_uploaded_by
    ) RETURNING id INTO v_run_id;

    -- Atomic Upsert of 96 blocks
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

    -- Data quality evaluation for the exact operating date
    INSERT INTO public.data_quality_evaluations (
        site_id, evaluation_date, completeness_pct, missing_blocks_count, freshness_status, validation_status, publication_gate_status
    ) VALUES (
        p_site_id, v_op_date, v_completeness, 0, p_freshness_status, v_validation_status, v_pub_gate
    ) ON CONFLICT (site_id, evaluation_date) DO UPDATE SET
        completeness_pct = EXCLUDED.completeness_pct,
        missing_blocks_count = EXCLUDED.missing_blocks_count,
        freshness_status = EXCLUDED.freshness_status,
        validation_status = EXCLUDED.validation_status,
        publication_gate_status = EXCLUDED.publication_gate_status;

    -- Site activation state update
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
            v_reason := 'Data ingestion active: ' || v_days_count || '/7 days calibrated';
        END IF;
    ELSE
        IF v_prev_status = 'ACTIVE' THEN
            v_new_status := 'DEGRADED';
            v_reason := 'Operational data quality below required threshold: ' || v_pub_gate;
        ELSE
            v_new_status := 'CALIBRATING';
            v_reason := 'Calibration in progress: ' || v_pub_gate;
        END IF;
    END IF;

    -- Atomic activation transition and history recording
    IF v_new_status IS DISTINCT FROM v_prev_status THEN
        UPDATE public.sites
        SET activation_status = v_new_status,
            activation_reason = v_reason,
            last_status_change = now(),
            updated_at = now()
        WHERE id = p_site_id;

        INSERT INTO public.site_activation_history (
            site_id, previous_status, new_status, reason, changed_by
        ) VALUES (
            p_site_id, v_prev_status, v_new_status, v_reason, p_uploaded_by
        );
    ELSE
        -- No transition: update updated_at without spamming history or changing last_status_change
        UPDATE public.sites
        SET activation_reason = v_reason,
            updated_at = now()
        WHERE id = p_site_id;
    END IF;

    -- Audit log for ingestion
    INSERT INTO public.audit_logs (
        organisation_id, site_id, actor_id, actor_role, action, entity_type, entity_id, details
    ) VALUES (
        v_org_id, p_site_id, p_uploaded_by, p_actor_role, 'AMR_INTERVAL_INGESTION_COMMITTED', 'INGESTION_RUN', v_run_id::text,
        jsonb_build_object(
            'filename', p_filename,
            'checksum', p_checksum_sha256,
            'total_rows', v_rows_count,
            'completeness_pct', v_completeness,
            'freshness_status', p_freshness_status,
            'validation_status', v_validation_status,
            'publication_gate_status', v_pub_gate,
            'site_activation_previous', v_prev_status,
            'site_activation_new', v_new_status,
            'days_calibrated', v_days_count
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'run_id', v_run_id,
        'site_id', p_site_id,
        'operating_date', v_op_date,
        'rows_ingested', v_rows_count,
        'completeness_pct', v_completeness,
        'publication_gate_status', v_pub_gate,
        'validation_status', v_validation_status,
        'activation_status', v_new_status,
        'days_calibrated', v_days_count
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.commit_ingestion_transaction(UUID, TEXT, VARCHAR, UUID, JSONB, VARCHAR, VARCHAR, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_ingestion_transaction(UUID, TEXT, VARCHAR, UUID, JSONB, VARCHAR, VARCHAR, UUID) TO service_role;

-- 4. Clean Canonical Audit Logs Contract (Remove fake backwards-compatibility columns)
CREATE OR REPLACE FUNCTION public.chain_audit_log()
RETURNS trigger AS $$
DECLARE
  last_hash VARCHAR(64);
  computed_payload TEXT;
BEGIN
  IF NEW.action IS NULL THEN
    NEW.action := 'SYSTEM_ACTION';
  END IF;

  IF NEW.entity_type IS NULL THEN
    NEW.entity_type := 'SYSTEM';
  END IF;

  IF NEW.actor_role IS NULL THEN
    NEW.actor_role := 'SYSTEM';
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

ALTER TABLE public.audit_logs DROP COLUMN IF EXISTS event_type CASCADE;
ALTER TABLE public.audit_logs DROP COLUMN IF EXISTS event_payload CASCADE;
