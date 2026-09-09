BEGIN;

ALTER TABLE public.dsm_evaluation_runs ADD COLUMN input_checksum text;
ALTER TABLE public.dsm_evaluation_runs ADD COLUMN result_snapshot jsonb;
ALTER TABLE public.dsm_incidents ALTER COLUMN max_deviation_pct DROP NOT NULL;
ALTER TABLE public.dsm_incidents ALTER COLUMN max_deviation_pct TYPE numeric;
ALTER TABLE public.dsm_incidents ALTER COLUMN estimated_exposure_inr DROP NOT NULL;

CREATE FUNCTION public.commit_dsm_evaluation_atomic(p_site_id uuid, p_org_id uuid, p_actor_id uuid,
  p_date date, p_input_rows jsonb, p_input_checksum text, p_result jsonb, p_incidents jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_role text; v_demo boolean; v_row jsonb; v_id uuid; v_old public.dsm_incidents;
  v_ids uuid[] := ARRAY[]::uuid[]; v_saved jsonb; v_same boolean;
BEGIN
  v_role := public.assert_actor_authority(p_actor_id,p_org_id,
    ARRAY['ORGANISATION_ADMIN','ENERGY_MANAGER','OPERATOR','FINANCE_SUSTAINABILITY_VIEWER','AETHEON_ANALYST'],p_site_id);
  -- The ingestion RPC takes the same site lock: evidence cannot change during publication.
  SELECT is_demo INTO v_demo FROM public.sites WHERE id=p_site_id AND organisation_id=p_org_id FOR UPDATE;
  IF NOT FOUND OR jsonb_array_length(p_input_rows) <> 96 OR jsonb_array_length(p_result->'blocks') <> 96 OR
    p_result->>'site_id' IS DISTINCT FROM p_site_id::text OR p_result->>'operating_date' IS DISTINCT FROM p_date::text OR
    p_result->>'model_version' IS DISTINCT FROM 'DSM_TECHNICAL_DEVIATION_v2.0' OR
    p_result->>'status' IS DISTINCT FROM 'COMPLETED' OR p_result->'input_rows' IS DISTINCT FROM p_input_rows OR
    (p_result#>>'{provenance,is_demo}')::boolean IS DISTINCT FROM v_demo OR
    p_result#>>'{provenance,input_checksum}' IS DISTINCT FROM p_input_checksum OR
    p_input_checksum !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'INVALID_DSM_EVIDENCE'; END IF;
  IF NOT v_demo THEN
    IF p_result->>'rule_status' IS DISTINCT FROM 'REGULATORY_CONFIGURATION_REQUIRED' OR
      p_result->>'estimated_total_exposure_inr' IS NOT NULL OR p_result->>'rule_version' IS NOT NULL OR
      EXISTS (SELECT 1 FROM jsonb_array_elements(p_result->'blocks') b WHERE b->>'estimated_penalty_inr' IS NOT NULL) OR
      EXISTS (SELECT 1 FROM jsonb_array_elements(p_incidents) b WHERE b->>'estimated_exposure_inr' IS NOT NULL)
      THEN RAISE EXCEPTION 'UNVERIFIED_MONETARY_AUTHORITY'; END IF;
    IF (SELECT count(*) FROM public.interval_data_96 WHERE site_id=p_site_id AND operating_date=p_date) <> 96 OR
      (SELECT count(DISTINCT e.block_index) FROM jsonb_to_recordset(p_input_rows) AS e(block_index int,
        operating_date date,timestamp_utc timestamptz,scheduled_drawal_kw numeric,actual_drawal_kw numeric)
        JOIN public.interval_data_96 d ON d.site_id=p_site_id AND d.operating_date=p_date AND d.block_index=e.block_index
        WHERE e.operating_date=p_date AND e.block_index BETWEEN 1 AND 96 AND d.timestamp_utc=e.timestamp_utc AND
          e.timestamp_utc=(p_date::timestamp AT TIME ZONE 'Asia/Kolkata')+(e.block_index-1)*interval '15 minutes' AND
          e.timestamp_utc+interval '15 minutes' <= now() AND e.scheduled_drawal_kw>=0 AND e.actual_drawal_kw>=0 AND
          d.scheduled_drawal_kw=e.scheduled_drawal_kw AND d.actual_drawal_kw=e.actual_drawal_kw) <> 96
      THEN RAISE EXCEPTION 'DSM_INPUTS_CHANGED_OR_INVALID'; END IF;
  END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_incidents) LOOP
    SELECT * INTO v_old FROM public.dsm_incidents WHERE site_id=p_site_id AND operating_date=p_date
      AND start_block=(v_row->>'start_block')::int AND end_block=(v_row->>'end_block')::int FOR UPDATE;
    v_same := FOUND AND v_old.severity=v_row->>'severity' AND
      v_old.max_deviation_pct IS NOT DISTINCT FROM (v_row->>'max_deviation_pct')::numeric AND
      v_old.total_excess_energy_kwh IS NOT DISTINCT FROM (v_row->>'total_excess_energy_kwh')::numeric AND
      v_old.estimated_exposure_inr IS NOT DISTINCT FROM (v_row->>'estimated_exposure_inr')::numeric AND
      v_old.root_cause_tag IS NOT DISTINCT FROM v_row->>'root_cause_tag';
    INSERT INTO public.dsm_incidents(site_id,operating_date,start_block,end_block,severity,max_deviation_pct,
      total_excess_energy_kwh,estimated_exposure_inr,root_cause_tag,acknowledged,acknowledged_by,acknowledged_at)
    VALUES(p_site_id,p_date,(v_row->>'start_block')::int,(v_row->>'end_block')::int,v_row->>'severity',
      (v_row->>'max_deviation_pct')::numeric,(v_row->>'total_excess_energy_kwh')::numeric,
      (v_row->>'estimated_exposure_inr')::numeric,v_row->>'root_cause_tag',
      CASE WHEN v_same THEN v_old.acknowledged ELSE false END,
      CASE WHEN v_same THEN v_old.acknowledged_by END,CASE WHEN v_same THEN v_old.acknowledged_at END)
    ON CONFLICT(site_id,operating_date,start_block,end_block) DO UPDATE SET
      severity=EXCLUDED.severity,max_deviation_pct=EXCLUDED.max_deviation_pct,
      total_excess_energy_kwh=EXCLUDED.total_excess_energy_kwh,estimated_exposure_inr=EXCLUDED.estimated_exposure_inr,
      root_cause_tag=EXCLUDED.root_cause_tag,acknowledged=EXCLUDED.acknowledged,
      acknowledged_by=EXCLUDED.acknowledged_by,acknowledged_at=EXCLUDED.acknowledged_at RETURNING id INTO v_id;
    v_ids := array_append(v_ids,v_id);
  END LOOP;
  DELETE FROM public.dsm_incidents WHERE site_id=p_site_id AND operating_date=p_date AND NOT(id=ANY(v_ids));
  SELECT p_result || jsonb_build_object('incidents',COALESCE(jsonb_agg(to_jsonb(i) ORDER BY start_block),'[]'::jsonb))
    INTO v_saved FROM public.dsm_incidents i WHERE site_id=p_site_id AND operating_date=p_date;
  INSERT INTO public.dsm_evaluation_runs(site_id,operating_date,input_completeness,validation_status,rule_version,
    rule_status,model_version,result_status,input_checksum,result_snapshot)
  VALUES(p_site_id,p_date,100,'PASSED',p_result->>'rule_version',p_result->>'rule_status',p_result->>'model_version',
    CASE WHEN cardinality(v_ids)=0 THEN 'NO_MATERIAL_INCIDENTS' ELSE 'INCIDENTS_DETECTED' END,p_input_checksum,v_saved)
  ON CONFLICT(site_id,operating_date) DO UPDATE SET calculation_timestamp=now(),input_completeness=100,
    validation_status='PASSED',rule_version=EXCLUDED.rule_version,rule_status=EXCLUDED.rule_status,
    model_version=EXCLUDED.model_version,result_status=EXCLUDED.result_status,
    input_checksum=EXCLUDED.input_checksum,result_snapshot=EXCLUDED.result_snapshot RETURNING id INTO v_id;
  INSERT INTO public.audit_logs(organisation_id,site_id,actor_id,actor_role,action,entity_type,entity_id,details)
    VALUES(p_org_id,p_site_id,p_actor_id,v_role,'DSM_EVALUATED','DSM_EVALUATION',v_id::text,
      jsonb_build_object('operating_date',p_date,'input_checksum',p_input_checksum,'incident_count',cardinality(v_ids)));
  RETURN v_saved;
END $$;
REVOKE ALL ON FUNCTION public.commit_dsm_evaluation_atomic(uuid,uuid,uuid,date,jsonb,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_dsm_evaluation_atomic(uuid,uuid,uuid,date,jsonb,text,jsonb,jsonb) TO service_role;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.dsm_evaluation_runs,public.dsm_incidents FROM anon,authenticated;

-- Every report in these domains must pass the route's current evidence checks, including source revocation.
CREATE POLICY "Domain evidence required for report reads" ON public.report_records AS RESTRICTIVE FOR SELECT TO anon,authenticated USING (
  module NOT IN ('GRID','DSM','BESS','COMPLIANCE') AND report_type NOT IN
    ('GRID_DAILY_BRIEF','GRID_MONTHLY_REPORT','DAILY_DISPATCH','DSM_MONTHLY_REVIEW','BESS_PERFORMANCE_REPORT','COMPLIANCE_AUDIT')
);
-- Download through the authorized report route so source revocation/provenance checks cannot be bypassed.
CREATE POLICY "Report downloads require evidence validation" ON storage.objects AS RESTRICTIVE FOR SELECT TO anon,authenticated
  USING (bucket_id <> 'tenant-reports');

COMMIT;
