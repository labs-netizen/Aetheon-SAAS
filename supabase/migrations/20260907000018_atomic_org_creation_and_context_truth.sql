-- Aetheon Energy Intelligence Platform - Migration 18: Atomic Organisation Creation & Context Truth
-- 1. Atomic RPC create_organisation_atomic (transactional rollback on audit failure)
-- 2. Revoke PUBLIC/anon/authenticated execute; grant service_role only
-- 3. Update handle_new_user() to prevent non-demo demand unit fabrication

-- ----------------------------------------------------------------------------
-- 1. Atomic Organisation Creation + Membership + Site + Audit
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_organisation_atomic(
    p_user_id UUID,
    p_user_email TEXT,
    p_org_name TEXT,
    p_legal_entity_name TEXT DEFAULT NULL,
    p_gstin TEXT DEFAULT NULL,
    p_site_params JSONB DEFAULT NULL,
    p_force_audit_failure BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_org RECORD;
    v_membership RECORD;
    v_site RECORD;
    v_has_site BOOLEAN := false;
    v_site_id UUID := NULL;
    v_site_name TEXT := NULL;
    v_state TEXT;
    v_discom TEXT;
    v_voltage TEXT;
    v_demand NUMERIC;
    v_unit TEXT;
    v_metering TEXT;
    v_load_class TEXT;
    v_is_demo BOOLEAN := false;
    v_audit_details JSONB;
BEGIN
    -- 1. Check if user already belongs to an active organisation
    IF EXISTS (
        SELECT 1 FROM public.memberships 
        WHERE user_id = p_user_id AND is_active = true
    ) THEN
        RAISE EXCEPTION 'USER_ALREADY_HAS_ORGANISATION';
    END IF;

    -- 2. Validate organisation name
    IF p_org_name IS NULL OR length(trim(p_org_name)) = 0 THEN
        RAISE EXCEPTION 'ORGANISATION_NAME_REQUIRED';
    END IF;

    -- 3. Insert Organisation
    INSERT INTO public.organisations (
        name,
        legal_entity_name,
        gstin,
        is_active
    ) VALUES (
        trim(p_org_name),
        COALESCE(NULLIF(trim(p_legal_entity_name), ''), trim(p_org_name)),
        NULLIF(trim(p_gstin), ''),
        true
    ) RETURNING * INTO v_org;

    -- 4. Insert ORGANISATION_ADMIN Membership
    INSERT INTO public.memberships (
        organisation_id,
        user_id,
        role,
        is_active
    ) VALUES (
        v_org.id,
        p_user_id,
        'ORGANISATION_ADMIN',
        true
    ) RETURNING * INTO v_membership;

    -- 5. Handle Site creation if valid params provided
    IF p_site_params IS NOT NULL AND p_site_params != '{}'::jsonb AND p_site_params != 'null'::jsonb THEN
        v_is_demo := COALESCE((p_site_params->>'is_demo')::boolean, false);
        v_site_name := COALESCE(NULLIF(trim(p_site_params->>'name'), ''), v_org.name || ' Main Facility');
        v_load_class := COALESCE(p_site_params->>'load_class', 'Continuous Process Industrial');

        IF v_is_demo THEN
            -- Demo site defaults allowed
            v_state := COALESCE(p_site_params->>'state', 'Maharashtra');
            v_discom := COALESCE(p_site_params->>'discom', 'MSEDCL');
            v_voltage := COALESCE(p_site_params->>'voltage_category', '33kV');
            v_metering := COALESCE(p_site_params->>'metering_point', 'Main Incomer Feeder');
            v_demand := COALESCE((p_site_params->>'contract_demand_value')::numeric, 1000);
            v_unit := COALESCE(p_site_params->>'contract_demand_unit', 'kVA');

            INSERT INTO public.sites (
                organisation_id, name, state, discom, voltage_category,
                contract_demand_value, contract_demand_unit, metering_point,
                load_class, timezone, activation_status, activation_reason, is_demo
            ) VALUES (
                v_org.id, v_site_name, v_state, v_discom, v_voltage,
                v_demand, v_unit, v_metering,
                v_load_class, 'Asia/Kolkata', 'AWAITING_DATA', 'Demo facility initialized', true
            ) RETURNING * INTO v_site;

            v_has_site := true;
            v_site_id := v_site.id;

            INSERT INTO public.site_access (site_id, user_id, granted_by)
            VALUES (v_site.id, p_user_id, p_user_id);
        ELSE
            -- Non-Demo: MUST NOT fabricate electrical parameters
            v_state := NULLIF(trim(p_site_params->>'state'), '');
            v_discom := NULLIF(trim(p_site_params->>'discom'), '');
            v_voltage := NULLIF(trim(p_site_params->>'voltage_category'), '');
            v_metering := NULLIF(trim(p_site_params->>'metering_point'), '');
            v_unit := NULLIF(trim(p_site_params->>'contract_demand_unit'), '');
            IF p_site_params ? 'contract_demand_value' AND p_site_params->>'contract_demand_value' IS NOT NULL THEN
                v_demand := (p_site_params->>'contract_demand_value')::numeric;
            ELSE
                v_demand := NULL;
            END IF;

            -- ALL 4 electrical parameters + state + discom required
            IF v_state IS NOT NULL AND v_discom IS NOT NULL AND
               v_voltage IS NOT NULL AND v_metering IS NOT NULL AND
               v_unit IS NOT NULL AND v_demand IS NOT NULL AND v_demand > 0 THEN

                INSERT INTO public.sites (
                    organisation_id, name, state, discom, voltage_category,
                    contract_demand_value, contract_demand_unit, metering_point,
                    load_class, timezone, activation_status, activation_reason, is_demo
                ) VALUES (
                    v_org.id, v_site_name, v_state, v_discom, v_voltage,
                    v_demand, v_unit, v_metering,
                    v_load_class, 'Asia/Kolkata', 'AWAITING_DATA',
                    'Newly registered facility awaiting initial AMR interval data upload', false
                ) RETURNING * INTO v_site;

                v_has_site := true;
                v_site_id := v_site.id;

                INSERT INTO public.site_access (site_id, user_id, granted_by)
                VALUES (v_site.id, p_user_id, p_user_id);
            END IF;
        END IF;
    END IF;

    -- 6. Forced audit failure hook for transactional rollback proving
    IF p_force_audit_failure THEN
        RAISE EXCEPTION 'FORCED_AUDIT_FAILURE_ROLLBACK';
    END IF;

    -- 7. Audit Log Entry
    v_audit_details := jsonb_build_object(
        'org_name', v_org.name,
        'site_name', v_site_name,
        'site_id', v_site_id,
        'registered_by', p_user_email,
        'configuration_status', CASE WHEN v_has_site THEN 'CONFIGURED' ELSE 'CONFIGURATION_REQUIRED' END
    );

    INSERT INTO public.audit_logs (
        organisation_id,
        site_id,
        actor_id,
        actor_role,
        action,
        entity_type,
        entity_id,
        details
    ) VALUES (
        v_org.id,
        v_site_id,
        p_user_id,
        'ORGANISATION_ADMIN',
        'ORGANISATION_CREATED',
        'ORGANISATION',
        v_org.id::text,
        v_audit_details
    );

    RETURN jsonb_build_object(
        'success', true,
        'organisation', to_jsonb(v_org),
        'membership', to_jsonb(v_membership),
        'site', CASE WHEN v_has_site THEN to_jsonb(v_site) ELSE NULL END,
        'configurationStatus', CASE WHEN v_has_site THEN 'CONFIGURED' ELSE 'CONFIGURATION_REQUIRED' END
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_organisation_atomic(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_organisation_atomic(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, BOOLEAN) TO service_role;

-- ----------------------------------------------------------------------------
-- 2. Registration Trigger: Prevent Non-Demo Electrical Fabrication
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  v_org_name TEXT;
  v_org_id UUID;
  v_site_id UUID;
  v_site_name TEXT;
  v_state TEXT;
  v_discom TEXT;
  v_voltage TEXT;
  v_metering TEXT;
  v_demand NUMERIC;
  v_unit TEXT;
  v_is_demo BOOLEAN;
BEGIN
  -- 1. Create Profile (Unconditionally unprivileged)
  INSERT INTO public.user_profiles (id, full_name, email, phone, is_platform_admin)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data->>'phone',
    false
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email;

  -- 2. If organisation_name was provided, create organisation and assign ORGANISATION_ADMIN
  v_org_name := new.raw_user_meta_data->>'organisation_name';
  IF v_org_name IS NOT NULL AND length(trim(v_org_name)) > 0 THEN
    INSERT INTO public.organisations (name, legal_entity_name, is_active)
    VALUES (trim(v_org_name), trim(v_org_name), true)
    RETURNING id INTO v_org_id;

    INSERT INTO public.memberships (organisation_id, user_id, role, is_active)
    VALUES (v_org_id, new.id, 'ORGANISATION_ADMIN', true)
    ON CONFLICT (organisation_id, user_id) DO NOTHING;

    v_is_demo := COALESCE((new.raw_user_meta_data->>'is_demo')::boolean, false);
    v_site_name := new.raw_user_meta_data->>'site_name';

    IF v_is_demo THEN
      -- Demo fixtures may retain deterministic defaults
      v_state := COALESCE(new.raw_user_meta_data->>'state', 'Maharashtra');
      v_discom := COALESCE(new.raw_user_meta_data->>'discom', 'MSEDCL');
      v_voltage := COALESCE(new.raw_user_meta_data->>'voltage_category', '33kV');
      v_metering := COALESCE(new.raw_user_meta_data->>'metering_point', 'Main Incomer Feeder');
      v_demand := COALESCE((new.raw_user_meta_data->>'contract_demand_value')::numeric, 1000);
      v_unit := COALESCE(new.raw_user_meta_data->>'contract_demand_unit', 'kVA');

      IF v_site_name IS NOT NULL AND length(trim(v_site_name)) > 0 THEN
        INSERT INTO public.sites (
          organisation_id, name, state, discom, voltage_category, 
          contract_demand_value, contract_demand_unit, metering_point, 
          load_class, timezone, activation_status, activation_reason, is_demo
        ) VALUES (
          v_org_id,
          trim(v_site_name),
          v_state,
          v_discom,
          v_voltage,
          v_demand,
          v_unit,
          v_metering,
          'Industrial C&I',
          'Asia/Kolkata',
          'AWAITING_DATA',
          'Demo site initialized',
          true
        ) RETURNING id INTO v_site_id;

        INSERT INTO public.site_access (site_id, user_id, granted_by)
        VALUES (v_site_id, new.id, new.id)
        ON CONFLICT (site_id, user_id) DO NOTHING;
      END IF;
    ELSE
      -- NON-DEMO: Do NOT invent or default required electrical configuration!
      -- Must be explicitly provided, otherwise site stays configuration-required/uncreated.
      v_state := NULLIF(trim(new.raw_user_meta_data->>'state'), '');
      v_discom := NULLIF(trim(new.raw_user_meta_data->>'discom'), '');
      v_voltage := NULLIF(trim(new.raw_user_meta_data->>'voltage_category'), '');
      v_metering := NULLIF(trim(new.raw_user_meta_data->>'metering_point'), '');
      v_unit := NULLIF(trim(new.raw_user_meta_data->>'contract_demand_unit'), '');
      IF new.raw_user_meta_data ? 'contract_demand_value' AND new.raw_user_meta_data->>'contract_demand_value' IS NOT NULL THEN
        v_demand := (new.raw_user_meta_data->>'contract_demand_value')::numeric;
      ELSE
        v_demand := NULL;
      END IF;

      -- Strictly require ALL 4 non-null electrical parameters: demand (>0), unit, voltage, metering
      IF v_site_name IS NOT NULL AND length(trim(v_site_name)) > 0 AND
         v_state IS NOT NULL AND length(trim(v_state)) > 0 AND
         v_discom IS NOT NULL AND length(trim(v_discom)) > 0 AND
         v_voltage IS NOT NULL AND length(trim(v_voltage)) > 0 AND
         v_metering IS NOT NULL AND length(trim(v_metering)) > 0 AND
         v_unit IS NOT NULL AND length(trim(v_unit)) > 0 AND
         v_demand IS NOT NULL AND v_demand > 0 THEN

        INSERT INTO public.sites (
          organisation_id, name, state, discom, voltage_category, 
          contract_demand_value, contract_demand_unit, metering_point, 
          load_class, timezone, activation_status, activation_reason, is_demo
        ) VALUES (
          v_org_id,
          trim(v_site_name),
          v_state,
          v_discom,
          v_voltage,
          v_demand,
          v_unit,
          v_metering,
          COALESCE(new.raw_user_meta_data->>'load_class', 'Continuous Process Industrial'),
          'Asia/Kolkata',
          'AWAITING_DATA',
          'Newly registered facility awaiting initial AMR interval data upload',
          false
        ) RETURNING id INTO v_site_id;

        INSERT INTO public.site_access (site_id, user_id, granted_by)
        VALUES (v_site_id, new.id, new.id)
        ON CONFLICT (site_id, user_id) DO NOTHING;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
