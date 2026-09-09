-- Pass 3: close confirmed storage, audit ordering, ingestion evidence and report bypasses.
BEGIN;

DROP POLICY IF EXISTS "Tenant users can view their organisation storage objects" ON storage.objects;
CREATE POLICY "Tenant users can view their organisation storage objects" ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id IN ('tenant-uploads','tenant-bills','compliance-evidence') AND (
    public.is_platform_admin() OR EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = public.auth_user_id() AND m.is_active
        AND (m.expires_at IS NULL OR m.expires_at > now())
        AND (m.role <> 'AETHEON_ANALYST' OR m.expires_at IS NOT NULL)
        AND split_part(objects.name,'/',1) = 'tenants'
        AND split_part(objects.name,'/',2) = m.organisation_id::text
        AND split_part(objects.name,'/',3) <> ''
        AND CASE WHEN split_part(objects.name,'/',3) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          THEN EXISTS (SELECT 1 FROM public.sites s
            WHERE s.id = split_part(objects.name,'/',3)::uuid AND s.organisation_id = m.organisation_id
              AND public.has_site_access(s.id))
          -- Organisation-level objects retain membership scope; no colleague's role grants site access.
          ELSE true END
    )
  )
);

-- All report records, including legacy/unknown types, require the API's current evidence validation.
ALTER POLICY "Domain evidence required for report reads" ON public.report_records USING (false);

-- The ledger cannot establish live model/factor provenance, including pre-existing demo outputs.
CREATE POLICY "Live renewable output requires verified provenance" ON public.renewable_generation_ledger
AS RESTRICTIVE FOR SELECT TO anon,authenticated USING (
  EXISTS (SELECT 1 FROM public.sites s WHERE s.id=renewable_generation_ledger.site_id AND s.is_demo IS TRUE)
);

CREATE OR REPLACE FUNCTION public.chain_audit_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  last_hash VARCHAR(64);
  computed_payload TEXT;
BEGIN
  NEW.action := COALESCE(NEW.action,'SYSTEM_ACTION');
  NEW.entity_type := COALESCE(NEW.entity_type,'SYSTEM');
  NEW.actor_role := COALESCE(NEW.actor_role,'SYSTEM');
  NEW.details := COALESCE(NEW.details,'{}'::jsonb);

  PERFORM pg_advisory_xact_lock(hashtext(COALESCE(NEW.organisation_id::text,'GLOBAL_AUDIT_CHAIN')));
  -- Defaults and supplied IDs are evaluated before this trigger's lock. Allocate the final ID
  -- inside the lock so ORDER BY id follows chain order even when concurrent arrivals reorder.
  -- Sequence gaps are intentional; existing immutable audit records are not rewritten.
  NEW.id := nextval('public.audit_logs_id_seq'::regclass);

  SELECT current_hash INTO last_hash FROM public.audit_logs
  WHERE organisation_id IS NOT DISTINCT FROM NEW.organisation_id ORDER BY id DESC LIMIT 1;
  NEW.previous_hash := COALESCE(last_hash,repeat('0',64));
  computed_payload := NEW.previous_hash || '|' ||
    COALESCE(NEW.actor_id::text,'SYSTEM') || '|' || NEW.actor_role || '|' ||
    COALESCE(NEW.organisation_id::text,'') || '|' || NEW.action || '|' ||
    NEW.entity_type || '|' || COALESCE(NEW.entity_id,'') || '|' ||
    NEW.details::text || '|' || NEW.created_at::text;
  NEW.current_hash := encode(sha256(computed_payload::bytea),'hex');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.chain_audit_log() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.chain_audit_log() TO service_role;

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
    p_org_id := COALESCE(p_org_id, (SELECT organisation_id FROM public.sites WHERE id=p_site_id));
    p_actor_role := public.assert_actor_authority(p_uploaded_by,p_org_id,ARRAY['ORGANISATION_ADMIN','ENERGY_MANAGER'],p_site_id);
    PERFORM 1 FROM public.sites WHERE id=p_site_id FOR UPDATE;
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

    -- The complete day must already have elapsed; caller freshness labels are not evidence.
    IF (SELECT is_demo FROM public.sites WHERE id=p_site_id) IS NOT TRUE THEN
        IF v_op_date IS NULL OR ((v_op_date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') > now() THEN
            RAISE EXCEPTION 'INCOMPLETE_OPERATING_DAY: Live observations require a completed 96-block IST day';
        END IF;
        p_freshness_status := CASE
            WHEN now() - ((v_op_date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') <= INTERVAL '24 hours' THEN 'RECENT'
            WHEN now() - ((v_op_date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') <= INTERVAL '168 hours' THEN 'DELAYED'
            ELSE 'STALE' END;
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION public.commit_ingestion_transaction(uuid,text,character varying,uuid,jsonb,character varying,character varying,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_ingestion_transaction(uuid,text,character varying,uuid,jsonb,character varying,character varying,uuid) TO service_role;

COMMIT;
