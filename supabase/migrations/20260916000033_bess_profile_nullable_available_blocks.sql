BEGIN;

CREATE OR REPLACE FUNCTION public.upsert_site_bess_simulation_profile(
  p_actor_id uuid, p_actor_role text, p_organisation_id uuid, p_site_id uuid, p_profile jsonb
) RETURNS public.site_bess_simulation_profiles
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_profile public.site_bess_simulation_profiles;
  v_available_blocks smallint[];
BEGIN
  PERFORM public.assert_backend_caller();
  IF p_actor_role NOT IN ('ORGANISATION_ADMIN','ENERGY_MANAGER') OR NOT EXISTS (
    SELECT 1 FROM public.memberships m WHERE m.user_id=p_actor_id AND m.organisation_id=p_organisation_id
      AND m.role=p_actor_role AND m.is_active AND (m.expires_at IS NULL OR m.expires_at > now())
  ) OR NOT EXISTS (
    SELECT 1 FROM public.sites s WHERE s.id=p_site_id AND s.organisation_id=p_organisation_id
  ) THEN
    RAISE EXCEPTION 'BESS_PROFILE_AUTHORITY_DENIED' USING ERRCODE='42501';
  END IF;

  IF p_profile->'available_blocks' IS NULL OR p_profile->'available_blocks' = 'null'::jsonb THEN
    v_available_blocks := NULL;
  ELSIF jsonb_typeof(p_profile->'available_blocks') <> 'array' THEN
    RAISE EXCEPTION 'BESS_PROFILE_AVAILABLE_BLOCKS_INVALID' USING ERRCODE='22023';
  ELSE
    SELECT ARRAY(SELECT jsonb_array_elements_text(p_profile->'available_blocks')::smallint)
      INTO v_available_blocks;
  END IF;

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
    (p_profile->>'degradation_cost_rs_per_kwh_throughput')::numeric,v_available_blocks,true,p_actor_id)
  ON CONFLICT(site_id) DO UPDATE SET nameplate_energy_capacity_kwh=EXCLUDED.nameplate_energy_capacity_kwh,
    max_charge_power_kw=EXCLUDED.max_charge_power_kw,max_discharge_power_kw=EXCLUDED.max_discharge_power_kw,
    minimum_soc_percent=EXCLUDED.minimum_soc_percent,maximum_soc_percent=EXCLUDED.maximum_soc_percent,
    initial_soc_percent=EXCLUDED.initial_soc_percent,final_soc_requirement=EXCLUDED.final_soc_requirement,
    final_soc_percent=EXCLUDED.final_soc_percent,charge_efficiency_percent=EXCLUDED.charge_efficiency_percent,
    discharge_efficiency_percent=EXCLUDED.discharge_efficiency_percent,
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
