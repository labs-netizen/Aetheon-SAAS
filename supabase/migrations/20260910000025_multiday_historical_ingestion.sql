BEGIN;

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
    v_op_date DATE;
    v_first_date DATE;
    v_completeness NUMERIC(5, 2) := 100.0;
    v_validation_status VARCHAR(20) := 'PASSED';
    v_pub_gate VARCHAR(50);
    v_prev_status VARCHAR(50);
    v_new_status VARCHAR(50);
    v_reason TEXT;
    v_days_count INTEGER;
    v_site_is_demo BOOLEAN;
BEGIN
    p_org_id := COALESCE(p_org_id, (SELECT organisation_id FROM public.sites WHERE id=p_site_id));
    p_actor_role := public.assert_actor_authority(
        p_uploaded_by, p_org_id, ARRAY['ORGANISATION_ADMIN','ENERGY_MANAGER'], p_site_id
    );
    SELECT is_demo INTO v_site_is_demo FROM public.sites
    WHERE id=p_site_id AND organisation_id=p_org_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'SITE_ORGANISATION_MISMATCH'; END IF;
    v_org_id := p_org_id;

    IF EXISTS (
        SELECT 1 FROM public.ingestion_runs
        WHERE site_id=p_site_id AND checksum_sha256=p_checksum_sha256 AND status='ACCEPTED'
    ) THEN
        RAISE EXCEPTION 'DUPLICATE_FILE: File with checksum % has already been committed for site %',
            p_checksum_sha256, p_site_id;
    END IF;

    IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'INGESTION_CONTRACT_VIOLATION: Payload rows must be a JSON array';
    END IF;
    v_rows_count := jsonb_array_length(p_rows);
    IF v_rows_count=0 OR v_rows_count % 96 <> 0 THEN
        RAISE EXCEPTION 'INGESTION_CONTRACT_VIOLATION: Payload must contain EXACTLY 96 interval blocks per operating date (received % total rows).', v_rows_count;
    END IF;

    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_rows) r
        WHERE r->>'operating_date' IS NULL
           OR r->>'operating_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
           OR r->>'block_index' !~ '^[0-9]+$'
    ) THEN
        RAISE EXCEPTION 'INGESTION_CONTRACT_VIOLATION: Invalid operating_date or block_index format';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM (
            SELECT
                r->>'operating_date' AS operating_date,
                COUNT(*) AS row_count,
                COUNT(DISTINCT (r->>'block_index')::integer) AS unique_blocks,
                MIN((r->>'block_index')::integer) AS min_block,
                MAX((r->>'block_index')::integer) AS max_block
            FROM jsonb_array_elements(p_rows) r
            GROUP BY r->>'operating_date'
        ) day_set
        WHERE row_count <> 96 OR unique_blocks <> 96 OR min_block <> 1 OR max_block <> 96
    ) THEN
        RAISE EXCEPTION 'INGESTION_CONTRACT_VIOLATION: Each operating date must contain contiguous blocks 1 to 96 exactly once';
    END IF;

    SELECT COUNT(DISTINCT (r->>'operating_date')::date),
           MIN((r->>'operating_date')::date),
           MAX((r->>'operating_date')::date)
    INTO v_distinct_dates, v_first_date, v_op_date
    FROM jsonb_array_elements(p_rows) r;

    IF v_rows_count <> v_distinct_dates * 96 THEN
        RAISE EXCEPTION 'INGESTION_CONTRACT_VIOLATION: Every operating date must contain exactly 96 blocks';
    END IF;

    IF NOT v_site_is_demo THEN
        IF v_op_date IS NULL OR ((v_op_date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') > now() THEN
            RAISE EXCEPTION 'INCOMPLETE_OPERATING_DAY: Live observations require completed 96-block IST days';
        END IF;
        p_freshness_status := CASE
            WHEN now() - ((v_op_date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') <= INTERVAL '24 hours' THEN 'RECENT'
            WHEN now() - ((v_op_date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') <= INTERVAL '168 hours' THEN 'DELAYED'
            ELSE 'STALE'
        END;
    END IF;

    v_pub_gate := CASE
        WHEN p_freshness_status='STALE' THEN 'BLOCKED_STALE_DATA'
        ELSE 'PUBLISHABLE'
    END;

    SELECT id INTO v_source_id FROM public.data_sources WHERE site_id=p_site_id LIMIT 1;
    IF v_source_id IS NULL THEN
        INSERT INTO public.data_sources (site_id, source_type, name, config, is_active)
        VALUES (p_site_id, 'CSV_UPLOAD', 'Automated Gateway CSV Ingestion', '{}'::jsonb, true)
        RETURNING id INTO v_source_id;
    END IF;

    INSERT INTO public.ingestion_runs (
        data_source_id, site_id, filename, checksum_sha256, status,
        total_rows, accepted_rows, rejected_rows, uploaded_by
    ) VALUES (
        v_source_id, p_site_id, p_filename, p_checksum_sha256, 'ACCEPTED',
        v_rows_count, v_rows_count, 0, p_uploaded_by
    ) RETURNING id INTO v_run_id;

    INSERT INTO public.interval_data_96 (
        site_id, operating_date, block_index, timestamp_utc,
        load_kw, generation_solar_kw, actual_drawal_kw, scheduled_drawal_kw,
        data_quality, ingestion_run_id
    )
    SELECT
        p_site_id,
        (r->>'operating_date')::date,
        (r->>'block_index')::integer,
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
    FROM jsonb_array_elements(p_rows) r
    ON CONFLICT (site_id, operating_date, block_index) DO UPDATE SET
        timestamp_utc=EXCLUDED.timestamp_utc,
        load_kw=EXCLUDED.load_kw,
        generation_solar_kw=EXCLUDED.generation_solar_kw,
        actual_drawal_kw=EXCLUDED.actual_drawal_kw,
        scheduled_drawal_kw=EXCLUDED.scheduled_drawal_kw,
        data_quality=EXCLUDED.data_quality,
        ingestion_run_id=EXCLUDED.ingestion_run_id;

    WITH operating_days AS (
        SELECT DISTINCT (r->>'operating_date')::date AS operating_date
        FROM jsonb_array_elements(p_rows) r
    ), day_quality AS (
        SELECT operating_date,
            CASE
                WHEN v_site_is_demo THEN p_freshness_status
                WHEN now() - ((operating_date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') <= INTERVAL '24 hours' THEN 'RECENT'
                WHEN now() - ((operating_date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') <= INTERVAL '168 hours' THEN 'DELAYED'
                ELSE 'STALE'
            END AS freshness_status
        FROM operating_days
    )
    INSERT INTO public.data_quality_evaluations (
        site_id, evaluation_date, completeness_pct, missing_blocks_count,
        freshness_status, validation_status, publication_gate_status
    )
    SELECT p_site_id, operating_date, 100.0, 0, freshness_status, 'PASSED',
        CASE WHEN freshness_status='STALE' THEN 'BLOCKED_STALE_DATA' ELSE 'PUBLISHABLE' END
    FROM day_quality
    ON CONFLICT (site_id, evaluation_date) DO UPDATE SET
        completeness_pct=EXCLUDED.completeness_pct,
        missing_blocks_count=EXCLUDED.missing_blocks_count,
        freshness_status=EXCLUDED.freshness_status,
        validation_status=EXCLUDED.validation_status,
        publication_gate_status=EXCLUDED.publication_gate_status;

    SELECT activation_status INTO v_prev_status FROM public.sites WHERE id=p_site_id;
    SELECT COUNT(DISTINCT operating_date) INTO v_days_count
    FROM public.interval_data_96 WHERE site_id=p_site_id;

    IF v_pub_gate='PUBLISHABLE' THEN
        IF v_days_count >= 7 AND p_freshness_status='RECENT' THEN
            v_new_status := 'ACTIVE';
            v_reason := 'Operational calibration complete with ' || v_days_count || ' days of interval data';
        ELSE
            v_new_status := 'CALIBRATING';
            v_reason := 'Data ingestion active: ' || v_days_count || '/7 days calibrated';
        END IF;
    ELSE
        IF v_prev_status='ACTIVE' THEN
            v_new_status := 'DEGRADED';
            v_reason := 'Operational data quality below required threshold: ' || v_pub_gate;
        ELSE
            v_new_status := 'CALIBRATING';
            v_reason := 'Calibration in progress: ' || v_pub_gate;
        END IF;
    END IF;

    IF v_new_status IS DISTINCT FROM v_prev_status THEN
        UPDATE public.sites SET activation_status=v_new_status, activation_reason=v_reason,
            last_status_change=now(), updated_at=now() WHERE id=p_site_id;
        INSERT INTO public.site_activation_history (site_id, previous_status, new_status, reason, changed_by)
        VALUES (p_site_id, v_prev_status, v_new_status, v_reason, p_uploaded_by);
    ELSE
        UPDATE public.sites SET activation_reason=v_reason, updated_at=now() WHERE id=p_site_id;
    END IF;

    INSERT INTO public.audit_logs (
        organisation_id, site_id, actor_id, actor_role, action, entity_type, entity_id, details
    ) VALUES (
        v_org_id, p_site_id, p_uploaded_by, p_actor_role,
        'AMR_INTERVAL_INGESTION_COMMITTED', 'INGESTION_RUN', v_run_id::text,
        jsonb_build_object(
            'filename', p_filename,
            'checksum', p_checksum_sha256,
            'total_rows', v_rows_count,
            'operating_days', v_distinct_dates,
            'operating_date_start', v_first_date,
            'operating_date_end', v_op_date,
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
        'operating_date_start', v_first_date,
        'operating_date_end', v_op_date,
        'operating_days', v_distinct_dates,
        'rows_ingested', v_rows_count,
        'completeness_pct', v_completeness,
        'publication_gate_status', v_pub_gate,
        'validation_status', v_validation_status,
        'activation_status', v_new_status,
        'days_calibrated', v_days_count
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION public.commit_ingestion_transaction(uuid,text,character varying,uuid,jsonb,character varying,character varying,uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_ingestion_transaction(uuid,text,character varying,uuid,jsonb,character varying,character varying,uuid)
TO service_role;

COMMIT;
