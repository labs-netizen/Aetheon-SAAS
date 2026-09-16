BEGIN;

CREATE FUNCTION public.valid_grid_critical_blocks(p_blocks smallint[]) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT COALESCE(bool_and(block_index BETWEEN 1 AND 96), true)
    AND count(*) = count(DISTINCT block_index)
  FROM unnest(p_blocks) AS block_index
$$;

CREATE TABLE public.site_flexibility_profiles (
  site_id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  flexible_load_kw numeric(14,3) NOT NULL CHECK (flexible_load_kw > 0),
  maximum_shift_energy_kwh_per_day numeric(14,3) NOT NULL CHECK (maximum_shift_energy_kwh_per_day > 0),
  maximum_upward_shift_kw_per_block numeric(14,3) NOT NULL CHECK (maximum_upward_shift_kw_per_block > 0),
  maximum_downward_shift_kw_per_block numeric(14,3) NOT NULL CHECK (maximum_downward_shift_kw_per_block > 0),
  earliest_shift_block smallint NOT NULL CHECK (earliest_shift_block BETWEEN 1 AND 96),
  latest_shift_block smallint NOT NULL CHECK (latest_shift_block BETWEEN 1 AND 96),
  maximum_shift_duration_blocks smallint NOT NULL CHECK (maximum_shift_duration_blocks BETWEEN 1 AND 96),
  critical_blocks smallint[] NOT NULL DEFAULT '{}',
  energy_conservation_required boolean NOT NULL,
  minimum_operating_load_kw numeric(14,3) CHECK (minimum_operating_load_kw >= 0),
  maximum_operating_load_kw numeric(14,3) CHECK (maximum_operating_load_kw > 0),
  is_active boolean NOT NULL DEFAULT true,
  updated_by uuid NOT NULL REFERENCES public.user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT flexibility_profile_site_org_fk FOREIGN KEY (site_id, organisation_id)
    REFERENCES public.sites(id, organisation_id) ON DELETE CASCADE,
  CHECK (earliest_shift_block <= latest_shift_block),
  CHECK (maximum_shift_duration_blocks <= latest_shift_block - earliest_shift_block + 1),
  CHECK (minimum_operating_load_kw IS NULL OR maximum_operating_load_kw IS NULL OR minimum_operating_load_kw <= maximum_operating_load_kw),
  CHECK (public.valid_grid_critical_blocks(critical_blocks))
);

ALTER TABLE public.site_flexibility_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_flexibility_profiles FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.site_flexibility_profiles TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON public.site_flexibility_profiles TO service_role;

CREATE POLICY "Members read own site flexibility profile"
  ON public.site_flexibility_profiles FOR SELECT TO authenticated
  USING (public.is_org_member(organisation_id) AND public.has_site_access(site_id));

CREATE FUNCTION public.upsert_site_flexibility_profile(
  p_actor_id uuid,
  p_actor_role text,
  p_organisation_id uuid,
  p_site_id uuid,
  p_profile jsonb
) RETURNS public.site_flexibility_profiles
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_profile public.site_flexibility_profiles;
BEGIN
  PERFORM public.assert_backend_caller();
  IF p_actor_role NOT IN ('ORGANISATION_ADMIN','ENERGY_MANAGER') OR NOT EXISTS (
    SELECT 1 FROM public.memberships m WHERE m.user_id=p_actor_id AND m.organisation_id=p_organisation_id
      AND m.role=p_actor_role AND m.is_active AND (m.expires_at IS NULL OR m.expires_at > now())
  ) OR NOT EXISTS (
    SELECT 1 FROM public.sites s WHERE s.id=p_site_id AND s.organisation_id=p_organisation_id
  ) THEN RAISE EXCEPTION 'FLEXIBILITY_PROFILE_AUTHORITY_DENIED' USING ERRCODE='42501'; END IF;

  INSERT INTO public.site_flexibility_profiles(site_id,organisation_id,flexible_load_kw,
    maximum_shift_energy_kwh_per_day,maximum_upward_shift_kw_per_block,maximum_downward_shift_kw_per_block,
    earliest_shift_block,latest_shift_block,maximum_shift_duration_blocks,critical_blocks,
    energy_conservation_required,minimum_operating_load_kw,maximum_operating_load_kw,is_active,updated_by)
  VALUES (p_site_id,p_organisation_id,(p_profile->>'flexible_load_kw')::numeric,
    (p_profile->>'maximum_shift_energy_kwh_per_day')::numeric,(p_profile->>'maximum_upward_shift_kw_per_block')::numeric,
    (p_profile->>'maximum_downward_shift_kw_per_block')::numeric,(p_profile->>'earliest_shift_block')::smallint,
    (p_profile->>'latest_shift_block')::smallint,(p_profile->>'maximum_shift_duration_blocks')::smallint,
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_profile->'critical_blocks','[]'::jsonb))::smallint),
    (p_profile->>'energy_conservation_required')::boolean,NULLIF(p_profile->>'minimum_operating_load_kw','')::numeric,
    NULLIF(p_profile->>'maximum_operating_load_kw','')::numeric,true,p_actor_id)
  ON CONFLICT (site_id) DO UPDATE SET flexible_load_kw=EXCLUDED.flexible_load_kw,
    maximum_shift_energy_kwh_per_day=EXCLUDED.maximum_shift_energy_kwh_per_day,
    maximum_upward_shift_kw_per_block=EXCLUDED.maximum_upward_shift_kw_per_block,
    maximum_downward_shift_kw_per_block=EXCLUDED.maximum_downward_shift_kw_per_block,
    earliest_shift_block=EXCLUDED.earliest_shift_block,latest_shift_block=EXCLUDED.latest_shift_block,
    maximum_shift_duration_blocks=EXCLUDED.maximum_shift_duration_blocks,critical_blocks=EXCLUDED.critical_blocks,
    energy_conservation_required=EXCLUDED.energy_conservation_required,
    minimum_operating_load_kw=EXCLUDED.minimum_operating_load_kw,maximum_operating_load_kw=EXCLUDED.maximum_operating_load_kw,
    is_active=true,updated_by=p_actor_id,updated_at=now()
  RETURNING * INTO v_profile;

  INSERT INTO public.audit_logs(organisation_id,site_id,actor_id,actor_role,action,entity_type,entity_id,details)
  VALUES(p_organisation_id,p_site_id,p_actor_id,p_actor_role,'SITE_FLEXIBILITY_PROFILE_UPSERTED',
    'SITE_FLEXIBILITY_PROFILE',p_site_id::text,jsonb_build_object('profile',to_jsonb(v_profile)-'updated_by'));
  RETURN v_profile;
END $$;

REVOKE ALL ON FUNCTION public.upsert_site_flexibility_profile(uuid,text,uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_site_flexibility_profile(uuid,text,uuid,uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.valid_grid_critical_blocks(smallint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.valid_grid_critical_blocks(smallint[]) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
