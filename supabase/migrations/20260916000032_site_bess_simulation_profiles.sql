BEGIN;

CREATE TABLE public.site_bess_simulation_profiles (
  site_id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  nameplate_energy_capacity_kwh numeric(14,3) NOT NULL CHECK (nameplate_energy_capacity_kwh > 0),
  max_charge_power_kw numeric(14,3) NOT NULL CHECK (max_charge_power_kw > 0),
  max_discharge_power_kw numeric(14,3) NOT NULL CHECK (max_discharge_power_kw > 0),
  minimum_soc_percent numeric(6,3) NOT NULL CHECK (minimum_soc_percent >= 0 AND minimum_soc_percent < 100),
  maximum_soc_percent numeric(6,3) NOT NULL CHECK (maximum_soc_percent > 0 AND maximum_soc_percent <= 100),
  initial_soc_percent numeric(6,3) NOT NULL CHECK (initial_soc_percent >= 0 AND initial_soc_percent <= 100),
  final_soc_requirement text NOT NULL CHECK (final_soc_requirement IN ('RETURN_TO_INITIAL_SOC','MINIMUM_FINAL_SOC')),
  final_soc_percent numeric(6,3) CHECK (final_soc_percent >= 0 AND final_soc_percent <= 100),
  charge_efficiency_percent numeric(6,3) NOT NULL CHECK (charge_efficiency_percent > 0 AND charge_efficiency_percent <= 100),
  discharge_efficiency_percent numeric(6,3) NOT NULL CHECK (discharge_efficiency_percent > 0 AND discharge_efficiency_percent <= 100),
  maximum_daily_throughput_kwh numeric(14,3) NOT NULL CHECK (maximum_daily_throughput_kwh > 0),
  degradation_cost_rs_per_kwh_throughput numeric(14,6) NOT NULL CHECK (degradation_cost_rs_per_kwh_throughput >= 0),
  available_blocks smallint[],
  is_active boolean NOT NULL DEFAULT true,
  updated_by uuid NOT NULL REFERENCES public.user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bess_simulation_profile_site_org_fk FOREIGN KEY (site_id, organisation_id)
    REFERENCES public.sites(id, organisation_id) ON DELETE CASCADE,
  CHECK (minimum_soc_percent < maximum_soc_percent),
  CHECK (initial_soc_percent BETWEEN minimum_soc_percent AND maximum_soc_percent),
  CHECK ((final_soc_requirement='RETURN_TO_INITIAL_SOC' AND final_soc_percent IS NULL) OR
         (final_soc_requirement='MINIMUM_FINAL_SOC' AND final_soc_percent BETWEEN minimum_soc_percent AND maximum_soc_percent)),
  CHECK (available_blocks IS NULL OR public.valid_grid_critical_blocks(available_blocks))
);

ALTER TABLE public.site_bess_simulation_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_bess_simulation_profiles FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.site_bess_simulation_profiles TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON public.site_bess_simulation_profiles TO service_role;

CREATE POLICY "Members read own site BESS simulation profile"
  ON public.site_bess_simulation_profiles FOR SELECT TO authenticated
  USING (public.is_org_member(organisation_id) AND public.has_site_access(site_id));

CREATE FUNCTION public.upsert_site_bess_simulation_profile(
  p_actor_id uuid, p_actor_role text, p_organisation_id uuid, p_site_id uuid, p_profile jsonb
) RETURNS public.site_bess_simulation_profiles
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_profile public.site_bess_simulation_profiles;
BEGIN
  PERFORM public.assert_backend_caller();
  IF p_actor_role NOT IN ('ORGANISATION_ADMIN','ENERGY_MANAGER') OR NOT EXISTS (
    SELECT 1 FROM public.memberships m WHERE m.user_id=p_actor_id AND m.organisation_id=p_organisation_id
      AND m.role=p_actor_role AND m.is_active AND (m.expires_at IS NULL OR m.expires_at > now())
  ) OR NOT EXISTS (SELECT 1 FROM public.sites s WHERE s.id=p_site_id AND s.organisation_id=p_organisation_id)
  THEN RAISE EXCEPTION 'BESS_PROFILE_AUTHORITY_DENIED' USING ERRCODE='42501'; END IF;

  INSERT INTO public.site_bess_simulation_profiles(site_id,organisation_id,nameplate_energy_capacity_kwh,
    max_charge_power_kw,max_discharge_power_kw,minimum_soc_percent,maximum_soc_percent,initial_soc_percent,final_soc_requirement,
    final_soc_percent,charge_efficiency_percent,discharge_efficiency_percent,maximum_daily_throughput_kwh,
    degradation_cost_rs_per_kwh_throughput,available_blocks,is_active,updated_by)
  VALUES(p_site_id,p_organisation_id,(p_profile->>'nameplate_energy_capacity_kwh')::numeric,
    (p_profile->>'max_charge_power_kw')::numeric,(p_profile->>'max_discharge_power_kw')::numeric,
    (p_profile->>'minimum_soc_percent')::numeric,(p_profile->>'maximum_soc_percent')::numeric,(p_profile->>'initial_soc_percent')::numeric,
    p_profile->>'final_soc_requirement',NULLIF(p_profile->>'final_soc_percent','')::numeric,
    (p_profile->>'charge_efficiency_percent')::numeric,(p_profile->>'discharge_efficiency_percent')::numeric,
    (p_profile->>'maximum_daily_throughput_kwh')::numeric,
    (p_profile->>'degradation_cost_rs_per_kwh_throughput')::numeric,
    CASE WHEN p_profile->'available_blocks' IS NULL THEN NULL ELSE
      ARRAY(SELECT jsonb_array_elements_text(p_profile->'available_blocks')::smallint) END,true,p_actor_id)
  ON CONFLICT(site_id) DO UPDATE SET nameplate_energy_capacity_kwh=EXCLUDED.nameplate_energy_capacity_kwh,
    max_charge_power_kw=EXCLUDED.max_charge_power_kw,max_discharge_power_kw=EXCLUDED.max_discharge_power_kw,
    minimum_soc_percent=EXCLUDED.minimum_soc_percent,maximum_soc_percent=EXCLUDED.maximum_soc_percent,initial_soc_percent=EXCLUDED.initial_soc_percent,
    final_soc_requirement=EXCLUDED.final_soc_requirement,final_soc_percent=EXCLUDED.final_soc_percent,
    charge_efficiency_percent=EXCLUDED.charge_efficiency_percent,discharge_efficiency_percent=EXCLUDED.discharge_efficiency_percent,
    maximum_daily_throughput_kwh=EXCLUDED.maximum_daily_throughput_kwh,
    degradation_cost_rs_per_kwh_throughput=EXCLUDED.degradation_cost_rs_per_kwh_throughput,
    available_blocks=EXCLUDED.available_blocks,is_active=true,updated_by=p_actor_id,updated_at=now()
  RETURNING * INTO v_profile;

  INSERT INTO public.audit_logs(organisation_id,site_id,actor_id,actor_role,action,entity_type,entity_id,details)
  VALUES(p_organisation_id,p_site_id,p_actor_id,p_actor_role,'SITE_BESS_SIMULATION_PROFILE_UPSERTED',
    'SITE_BESS_SIMULATION_PROFILE',p_site_id::text,jsonb_build_object('profile',to_jsonb(v_profile)-'updated_by'));
  RETURN v_profile;
END $$;

REVOKE ALL ON FUNCTION public.upsert_site_bess_simulation_profile(uuid,text,uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_site_bess_simulation_profile(uuid,text,uuid,uuid,jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
