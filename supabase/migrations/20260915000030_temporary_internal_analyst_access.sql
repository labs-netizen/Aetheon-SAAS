BEGIN;

CREATE TABLE public.internal_access_grants (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role = 'AETHEON_ANALYST'),
  is_active boolean NOT NULL DEFAULT true,
  valid_from timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  granted_by_database_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revocation_reason text,
  UNIQUE (user_id, role),
  CHECK (expires_at > valid_from),
  CHECK (expires_at <= valid_from + interval '90 days')
);

CREATE INDEX idx_internal_access_active_user
  ON public.internal_access_grants(user_id, role, expires_at)
  WHERE is_active;

ALTER TABLE public.internal_access_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.internal_access_grants FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.internal_access_grants TO service_role;

CREATE FUNCTION public.grant_temporary_aetheon_analyst(
  p_user_id uuid,
  p_expires_at timestamptz,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_grant public.internal_access_grants;
BEGIN
  PERFORM public.assert_backend_caller();
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'ANALYST_USER_NOT_FOUND' USING ERRCODE = '22023';
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() OR p_expires_at > now() + interval '90 days' THEN
    RAISE EXCEPTION 'INVALID_ANALYST_EXPIRY' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'ANALYST_GRANT_REASON_REQUIRED' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.internal_access_grants(user_id,role,is_active,valid_from,expires_at,reason,
    granted_by_database_role,updated_at,revoked_at,revocation_reason)
  VALUES (p_user_id,'AETHEON_ANALYST',true,now(),p_expires_at,btrim(p_reason),
    current_setting('role', true),now(),NULL,NULL)
  ON CONFLICT (user_id,role) DO UPDATE SET
    is_active=true, valid_from=now(), expires_at=excluded.expires_at, reason=excluded.reason,
    granted_by_database_role=excluded.granted_by_database_role, updated_at=now(), revoked_at=NULL, revocation_reason=NULL
  RETURNING * INTO v_grant;

  INSERT INTO public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,details)
  VALUES (NULL,'PLATFORM_ADMINISTRATION','TEMPORARY_AETHEON_ANALYST_GRANTED','INTERNAL_ACCESS_GRANT',v_grant.id::text,
    jsonb_build_object('user_id',p_user_id,'role','AETHEON_ANALYST','valid_from',v_grant.valid_from,
      'expires_at',v_grant.expires_at,'reason',v_grant.reason,'database_role',v_grant.granted_by_database_role));
  RETURN jsonb_build_object('status','GRANTED','grant_id',v_grant.id,'user_id',p_user_id,
    'role',v_grant.role,'valid_from',v_grant.valid_from,'expires_at',v_grant.expires_at);
END $$;

CREATE FUNCTION public.revoke_temporary_aetheon_analyst(
  p_user_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_grant public.internal_access_grants;
BEGIN
  PERFORM public.assert_backend_caller();
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'ANALYST_REVOCATION_REASON_REQUIRED' USING ERRCODE = '22023';
  END IF;
  UPDATE public.internal_access_grants SET is_active=false,revoked_at=now(),revocation_reason=btrim(p_reason),updated_at=now()
  WHERE user_id=p_user_id AND role='AETHEON_ANALYST' AND is_active
  RETURNING * INTO v_grant;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACTIVE_ANALYST_GRANT_NOT_FOUND' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,details)
  VALUES (NULL,'PLATFORM_ADMINISTRATION','TEMPORARY_AETHEON_ANALYST_REVOKED','INTERNAL_ACCESS_GRANT',v_grant.id::text,
    jsonb_build_object('user_id',p_user_id,'role','AETHEON_ANALYST','reason',btrim(p_reason)));
  RETURN jsonb_build_object('status','REVOKED','grant_id',v_grant.id,'user_id',p_user_id);
END $$;

REVOKE ALL ON FUNCTION public.grant_temporary_aetheon_analyst(uuid,timestamptz,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_temporary_aetheon_analyst(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_temporary_aetheon_analyst(uuid,timestamptz,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_temporary_aetheon_analyst(uuid,text) TO service_role;

-- Supersede migration 029's actor check so a separate temporary grant can coexist
-- with an unchanged customer tenant membership.
CREATE OR REPLACE FUNCTION public.commit_iex_dam_market_prices(
  p_actor_id uuid, p_source_file_name text, p_source_file_hash text, p_source_reference text,
  p_published_at timestamptz, p_fetched_at timestamptz, p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_import_id uuid; v_total_rows integer; v_total_days integer; v_min_date date; v_max_date date; v_role text;
BEGIN
  PERFORM public.assert_backend_caller();
  IF p_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id=p_actor_id AND up.is_platform_admin) THEN
    SELECT 'AETHEON_ANALYST' INTO v_role WHERE EXISTS (
      SELECT 1 FROM public.memberships m WHERE m.user_id=p_actor_id AND m.is_active AND m.role='AETHEON_ANALYST'
        AND m.expires_at IS NOT NULL AND m.expires_at > now()
    ) OR EXISTS (
      SELECT 1 FROM public.internal_access_grants g WHERE g.user_id=p_actor_id AND g.role='AETHEON_ANALYST'
        AND g.is_active AND g.valid_from <= now() AND g.expires_at > now()
    );
    IF v_role IS NULL THEN RAISE EXCEPTION 'PLATFORM_MARKET_DATA_ADMIN_REQUIRED' USING ERRCODE='42501'; END IF;
  END IF;
  IF p_source_file_name IS NULL OR length(btrim(p_source_file_name))=0 OR
     p_source_reference IS NULL OR p_source_reference !~* '^https://([^/]+\.)?(iexindia\.com|iexindia\.in)(/|$)' OR
     p_source_file_hash !~ '^[0-9a-f]{64}$' OR p_fetched_at IS NULL THEN
    RAISE EXCEPTION 'INVALID_OFFICIAL_SOURCE_PROVENANCE' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)=0 THEN
    RAISE EXCEPTION 'EMPTY_MARKET_PRICE_IMPORT' USING ERRCODE='22023';
  END IF;
  WITH rows AS (SELECT * FROM jsonb_to_recordset(p_rows) AS x(delivery_date date,block_index integer,time_start text,time_end text,mcp_rs_per_mwh numeric))
  SELECT count(*),count(DISTINCT delivery_date),min(delivery_date),max(delivery_date)
    INTO v_total_rows,v_total_days,v_min_date,v_max_date FROM rows;
  IF EXISTS (
    WITH rows AS (SELECT * FROM jsonb_to_recordset(p_rows) AS x(delivery_date date,block_index integer,time_start text,time_end text,mcp_rs_per_mwh numeric))
    SELECT 1 FROM rows WHERE delivery_date IS NULL OR block_index NOT BETWEEN 1 AND 96 OR mcp_rs_per_mwh IS NULL OR mcp_rs_per_mwh<0
      OR time_start IS DISTINCT FROM to_char(time '00:00'+((block_index-1)*interval '15 minutes'),'HH24:MI')
      OR time_end IS DISTINCT FROM CASE WHEN block_index=96 THEN '24:00' ELSE to_char(time '00:00'+(block_index*interval '15 minutes'),'HH24:MI') END
  ) OR EXISTS (
    WITH rows AS (SELECT * FROM jsonb_to_recordset(p_rows) AS x(delivery_date date,block_index integer,time_start text,time_end text,mcp_rs_per_mwh numeric))
    SELECT 1 FROM rows GROUP BY delivery_date HAVING count(*)<>96 OR count(DISTINCT block_index)<>96 OR min(block_index)<>1 OR max(block_index)<>96
  ) THEN RAISE EXCEPTION 'INVALID_96_BLOCK_MARKET_DAY' USING ERRCODE='22023'; END IF;
  INSERT INTO public.market_price_imports(exchange,market_product,source_type,source_reference,source_file_name,source_file_hash,
    published_at,fetched_at,imported_by,provenance_status,verification_status,delivery_date_start,delivery_date_end,total_rows,total_days)
  VALUES ('IEX','DAM','OFFICIAL_EXCHANGE_EXPORT',btrim(p_source_reference),btrim(p_source_file_name),p_source_file_hash,
    p_published_at,p_fetched_at,p_actor_id,'OFFICIAL_SOURCE_CONFIRMED','VERIFIED',v_min_date,v_max_date,v_total_rows,v_total_days)
  RETURNING id INTO v_import_id;
  INSERT INTO public.market_price_blocks(import_id,exchange,market_product,delivery_date,block_index,time_start,time_end,mcp_rs_per_mwh,
    source_type,source_reference,source_file_hash,published_at,fetched_at,provenance_status,verification_status)
  SELECT v_import_id,'IEX','DAM',r.delivery_date,r.block_index,r.time_start,r.time_end,r.mcp_rs_per_mwh,'OFFICIAL_EXCHANGE_EXPORT',
    btrim(p_source_reference),p_source_file_hash,p_published_at,p_fetched_at,'OFFICIAL_SOURCE_CONFIRMED','VERIFIED'
  FROM jsonb_to_recordset(p_rows) AS r(delivery_date date,block_index integer,time_start text,time_end text,mcp_rs_per_mwh numeric);
  INSERT INTO public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,details)
  VALUES (p_actor_id,COALESCE(v_role,'PLATFORM_ADMIN'),'IEX_DAM_PRICE_IMPORT','MARKET_PRICE_IMPORT',v_import_id::text,
    jsonb_build_object('exchange','IEX','market_product','DAM','source_file_hash',p_source_file_hash,'delivery_date_start',v_min_date,
      'delivery_date_end',v_max_date,'total_rows',v_total_rows,'total_days',v_total_days));
  RETURN jsonb_build_object('import_id',v_import_id,'status','COMMITTED','total_rows',v_total_rows,'total_days',v_total_days,
    'delivery_date_start',v_min_date,'delivery_date_end',v_max_date);
EXCEPTION WHEN unique_violation THEN
  IF EXISTS (SELECT 1 FROM public.market_price_imports WHERE source_file_hash=p_source_file_hash) THEN
    RAISE EXCEPTION 'DUPLICATE_MARKET_PRICE_FILE' USING ERRCODE='23505';
  END IF;
  RAISE EXCEPTION 'MARKET_PRICE_DATE_ALREADY_IMPORTED' USING ERRCODE='23505';
END $$;

REVOKE ALL ON FUNCTION public.commit_iex_dam_market_prices(uuid,text,text,text,timestamptz,timestamptz,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_iex_dam_market_prices(uuid,text,text,text,timestamptz,timestamptz,jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
