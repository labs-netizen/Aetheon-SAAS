-- Pass 1: close audited-route bypasses and bind privileged writes to tenant authority.
BEGIN;

-- Remove policies by catalog identity, including PostgreSQL-truncated legacy names.
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND cmd <> 'SELECT' AND tablename = ANY (ARRAY[
      'memberships','organisation_invitations','site_access','sites','interval_data_96',
      'bess_assets','entitlements','report_records','audit_logs','billing_checkout_sessions',
      'subscriptions','subscription_items','invoices','processed_webhook_events',
      'ingestion_runs','site_activation_history','alerts','dsm_incidents'])
  LOOP EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename); END LOOP;
END $$;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON
  public.memberships, public.organisation_invitations, public.site_access, public.sites,
  public.interval_data_96, public.bess_assets, public.entitlements, public.report_records,
  public.audit_logs, public.billing_checkout_sessions, public.subscriptions,
  public.subscription_items, public.invoices, public.processed_webhook_events,
  public.ingestion_runs, public.site_activation_history, public.alerts, public.dsm_incidents
  FROM anon, authenticated;
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Users view invitations sent to their email or Org Admins view all" ON public.organisation_invitations;
CREATE POLICY "Administrators read tenant invitations" ON public.organisation_invitations
  FOR SELECT TO authenticated USING (public.has_org_role(organisation_id, 'ORGANISATION_ADMIN') OR public.is_platform_admin());

-- Composite foreign keys prevent privileged routes from accidentally joining tenants.
ALTER TABLE public.sites ADD CONSTRAINT sites_id_org_unique UNIQUE (id, organisation_id);
ALTER TABLE public.organisation_invitations ADD CONSTRAINT invitation_site_org_fk
  FOREIGN KEY (site_id, organisation_id) REFERENCES public.sites(id, organisation_id) NOT VALID;
ALTER TABLE public.billing_checkout_sessions ADD CONSTRAINT checkout_site_org_fk
  FOREIGN KEY (site_id, organisation_id) REFERENCES public.sites(id, organisation_id) NOT VALID;
ALTER TABLE public.entitlements ADD CONSTRAINT entitlement_site_org_fk
  FOREIGN KEY (site_id, organisation_id) REFERENCES public.sites(id, organisation_id) NOT VALID;
ALTER TABLE public.report_records ADD CONSTRAINT report_site_org_fk
  FOREIGN KEY (site_id, organisation_id) REFERENCES public.sites(id, organisation_id) NOT VALID;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_site_org_fk
  FOREIGN KEY (site_id, organisation_id) REFERENCES public.sites(id, organisation_id) NOT VALID;

CREATE FUNCTION public.assert_backend_caller() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  -- CURRENT_USER is the definer here and cannot identify the invoker.
  IF current_setting('role', true) IS DISTINCT FROM 'service_role'
     AND NOT (session_user IN ('postgres', 'supabase_admin') AND current_setting('role', true) IN ('none','postgres','supabase_admin')) THEN
    RAISE EXCEPTION 'FORBIDDEN_BACKEND_CALLER' USING ERRCODE = '42501';
  END IF;
END $$;

CREATE FUNCTION public.assert_actor_authority(p_actor uuid, p_org uuid, p_roles text[], p_site uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE m public.memberships;
BEGIN
  PERFORM public.assert_backend_caller();
  IF p_site IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sites WHERE id=p_site AND organisation_id=p_org) THEN
    RAISE EXCEPTION 'SITE_ORGANISATION_MISMATCH' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO m FROM public.memberships WHERE organisation_id=p_org AND user_id=p_actor FOR SHARE;
  IF NOT FOUND OR NOT m.is_active OR NOT (m.role = ANY(p_roles)) OR
      (m.expires_at IS NOT NULL AND m.expires_at <= now()) OR
      (m.role='AETHEON_ANALYST' AND m.expires_at IS NULL) THEN
    RAISE EXCEPTION 'FORBIDDEN_ACTOR_AUTHORITY' USING ERRCODE = '42501';
  END IF;
  IF p_site IS NOT NULL AND m.role <> 'ORGANISATION_ADMIN' THEN
    PERFORM 1 FROM public.site_access WHERE site_id=p_site AND user_id=p_actor FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN_SITE_ACCESS' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN m.role;
END $$;

CREATE FUNCTION public.create_site_atomic(p_org_id uuid, p_actor_id uuid, p_site jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE s public.sites; v_role text;
BEGIN
  v_role := public.assert_actor_authority(p_actor_id, p_org_id, ARRAY['ORGANISATION_ADMIN']);
  IF COALESCE((p_site->>'is_demo')::boolean, false) THEN RAISE EXCEPTION 'DEMO_PROVISIONING_FORBIDDEN'; END IF;
  INSERT INTO public.sites (organisation_id, name, state, discom, voltage_category,
    contract_demand_value, contract_demand_unit, metering_point, load_class,
    activation_status, activation_reason, is_demo)
  VALUES (p_org_id, NULLIF(trim(p_site->>'name'),''), NULLIF(trim(p_site->>'state'),''),
    NULLIF(trim(p_site->>'discom'),''), NULLIF(trim(p_site->>'voltage_category'),''),
    (p_site->>'contract_demand_value')::numeric, p_site->>'contract_demand_unit',
    NULLIF(trim(p_site->>'metering_point'),''), COALESCE(p_site->>'load_class','Industrial C&I'),
    'CONFIGURED', 'Initial site electrical profile configured', false) RETURNING * INTO s;
  INSERT INTO public.site_access(site_id,user_id,granted_by) VALUES(s.id,p_actor_id,p_actor_id);
  INSERT INTO public.site_activation_history(site_id,previous_status,new_status,reason,changed_by)
    VALUES(s.id,NULL,'CONFIGURED','Site electrical parameters initialized via onboarding wizard',p_actor_id);
  INSERT INTO public.audit_logs(organisation_id,site_id,actor_id,actor_role,action,entity_type,entity_id,details)
    VALUES(p_org_id,s.id,p_actor_id,v_role,'SITE_CREATED','SITE',s.id::text,p_site);
  RETURN to_jsonb(s);
END $$;

-- Tokens are presented to the service route, never used as membership authority.
CREATE FUNCTION public.accept_invitation_atomic(p_token_hash text, p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE i public.organisation_invitations; m public.memberships; v_email text;
BEGIN
  PERFORM public.assert_backend_caller();
  SELECT email INTO v_email FROM auth.users WHERE id=p_user_id AND email_confirmed_at IS NOT NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMAIL_BINDING_FORBIDDEN'; END IF;
  SELECT * INTO i FROM public.organisation_invitations
    WHERE token_hash=p_token_hash OR (token_hash IS NULL AND encode(sha256(token::bytea),'hex')=p_token_hash)
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_TOKEN'; END IF;
  IF lower(trim(v_email)) IS DISTINCT FROM lower(trim(i.email)) THEN RAISE EXCEPTION 'EMAIL_BINDING_FORBIDDEN'; END IF;
  IF i.status <> 'PENDING' THEN RAISE EXCEPTION 'ALREADY_USED'; END IF;
  IF i.expires_at <= now() THEN RAISE EXCEPTION 'EXPIRED'; END IF;
  IF i.role NOT IN ('ORGANISATION_ADMIN','ENERGY_MANAGER','OPERATOR','FINANCE_SUSTAINABILITY_VIEWER') THEN
    RAISE EXCEPTION 'FORBIDDEN_INVITATION_ROLE';
  END IF;
  PERFORM public.assert_actor_authority(i.invited_by,i.organisation_id,ARRAY['ORGANISATION_ADMIN'],i.site_id);
  -- Serialize distinct invitations accepted concurrently for the same membership.
  PERFORM pg_advisory_xact_lock(hashtextextended(i.organisation_id::text || p_user_id::text, 0));
  SELECT * INTO m FROM public.memberships WHERE organisation_id=i.organisation_id AND user_id=p_user_id FOR UPDATE;
  IF FOUND THEN
    IF NOT m.is_active OR m.role <> i.role OR (m.expires_at IS NOT NULL AND m.expires_at <= now()) THEN
      RAISE EXCEPTION 'MEMBERSHIP_CONFLICT';
    END IF;
  ELSE
    INSERT INTO public.memberships(organisation_id,user_id,role,is_active)
      VALUES(i.organisation_id,p_user_id,i.role,true);
  END IF;
  IF i.site_id IS NOT NULL THEN
    INSERT INTO public.site_access(site_id,user_id,granted_by) VALUES(i.site_id,p_user_id,i.invited_by)
      ON CONFLICT(site_id,user_id) DO NOTHING;
  END IF;
  UPDATE public.organisation_invitations SET status='ACCEPTED' WHERE id=i.id;
  INSERT INTO public.audit_logs(organisation_id,site_id,actor_id,actor_role,action,entity_type,entity_id,details)
    VALUES(i.organisation_id,i.site_id,p_user_id,i.role,'INVITATION_ACCEPTED','INVITATION',i.id::text,
      jsonb_build_object('email',i.email,'role',i.role,'siteId',i.site_id));
  RETURN jsonb_build_object('organisation_id',i.organisation_id,'role',i.role);
END $$;


CREATE OR REPLACE FUNCTION public.update_site_config_atomic(
    p_site_id UUID,
    p_updates JSONB,
    p_actor_id UUID,
    p_actor_role TEXT,
    p_org_id UUID,
    p_force_audit_failure BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_site RECORD;
    v_audit_details JSONB;
BEGIN
    p_actor_role := public.assert_actor_authority(p_actor_id,p_org_id,ARRAY['ORGANISATION_ADMIN','ENERGY_MANAGER'],p_site_id);
    SELECT * INTO v_site FROM public.sites WHERE id = p_site_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'SITE_NOT_FOUND';
    END IF;

    UPDATE public.sites
    SET
        name = COALESCE(p_updates->>'name', name),
        state = COALESCE(p_updates->>'state', state),
        discom = COALESCE(p_updates->>'discom', discom),
        voltage_category = COALESCE(p_updates->>'voltage_category', voltage_category),
        contract_demand_value = CASE 
            WHEN p_updates ? 'contract_demand_value' THEN (p_updates->>'contract_demand_value')::numeric 
            ELSE contract_demand_value 
        END,
        metering_point = COALESCE(p_updates->>'metering_point', metering_point),
        load_class = COALESCE(p_updates->>'load_class', load_class),
        updated_at = now()
    WHERE id = p_site_id
    RETURNING * INTO v_site;

    -- Forced audit failure hook for transactional rollback proving
    IF p_force_audit_failure THEN
        RAISE EXCEPTION 'FORCED_AUDIT_FAILURE_ROLLBACK';
    END IF;

    v_audit_details := jsonb_build_object(
        'updates', p_updates,
        'site_id', p_site_id
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
        p_org_id,
        p_site_id,
        p_actor_id,
        COALESCE(p_actor_role, 'ORGANISATION_ADMIN'),
        'SITE_CONFIGURATION_UPDATED',
        'SITE',
        p_site_id::text,
        v_audit_details
    );

    RETURN to_jsonb(v_site);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_invitation_atomic(
    p_org_id UUID,
    p_email TEXT,
    p_role TEXT,
    p_site_id UUID,
    p_token TEXT,
    p_expires_at TIMESTAMPTZ,
    p_invited_by UUID,
    p_actor_role TEXT,
    p_force_audit_failure BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_invite RECORD;
    v_audit_details JSONB;
BEGIN
    p_actor_role := public.assert_actor_authority(p_invited_by,p_org_id,ARRAY['ORGANISATION_ADMIN'],p_site_id);
    IF p_role NOT IN ('ORGANISATION_ADMIN','ENERGY_MANAGER','OPERATOR','FINANCE_SUSTAINABILITY_VIEWER') THEN
      RAISE EXCEPTION 'FORBIDDEN_INVITATION_ROLE';
    END IF;
    IF p_expires_at IS NULL OR p_expires_at <= now() OR length(p_token) < 32 THEN
      RAISE EXCEPTION 'INVALID_INVITATION';
    END IF;
    INSERT INTO public.organisation_invitations (
        organisation_id,
        email,
        role,
        site_id,
        token,
        invited_by,
        status,
        expires_at
    ) VALUES (
        p_org_id,
        p_email,
        p_role,
        p_site_id,
        p_token,
        p_invited_by,
        'PENDING',
        p_expires_at
    ) RETURNING * INTO v_invite;

    -- Forced audit failure hook for transactional rollback proving
    IF p_force_audit_failure THEN
        RAISE EXCEPTION 'FORCED_AUDIT_FAILURE_ROLLBACK';
    END IF;

    v_audit_details := jsonb_build_object(
        'invitationId', v_invite.id,
        'recipientEmail', p_email,
        'intendedRole', p_role,
        'siteId', p_site_id
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
        p_org_id,
        p_site_id,
        p_invited_by,
        COALESCE(p_actor_role, 'ORGANISATION_ADMIN'),
        'INVITATION_CREATED',
        'INVITATION',
        v_invite.id::text,
        v_audit_details
    );

    RETURN to_jsonb(v_invite);
END;
$$;

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
    PERFORM public.assert_backend_caller();
    PERFORM 1 FROM auth.users WHERE id=p_user_id AND lower(email)=lower(p_user_email) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN_USER_IDENTITY'; END IF;
    IF COALESCE((p_site_params->>'is_demo')::boolean,false) THEN RAISE EXCEPTION 'DEMO_PROVISIONING_FORBIDDEN'; END IF;
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

    v_is_demo := false; -- User-editable metadata cannot provision a trusted demo fixture.
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

CREATE OR REPLACE FUNCTION public.acknowledge_alert_atomic(
    p_alert_id UUID,
    p_user_id UUID,
    p_user_role VARCHAR(50),
    p_org_id UUID
)
RETURNS JSONB AS $$
DECLARE
    v_alert RECORD;
BEGIN
    p_user_role := public.assert_actor_authority(p_user_id,p_org_id,ARRAY['ORGANISATION_ADMIN','ENERGY_MANAGER','OPERATOR'],(SELECT site_id FROM public.alerts WHERE id=p_alert_id AND organisation_id=p_org_id));
    IF NOT EXISTS (SELECT 1 FROM public.alerts WHERE id=p_alert_id AND organisation_id=p_org_id) THEN RAISE EXCEPTION 'SITE_ORGANISATION_MISMATCH'; END IF;
    -- Security Check: Only service_role or postgres
    IF current_setting('role', true) != 'service_role' AND CURRENT_USER != 'postgres' THEN
        RAISE EXCEPTION 'PERMISSION DENIED: Alert acknowledgement requires service-role.';
    END IF;

    -- Fetch alert to verify it exists and get details
    SELECT * INTO v_alert
    FROM public.alerts
    WHERE id = p_alert_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ALERT_NOT_FOUND: Alert % not found', p_alert_id;
    END IF;

    IF v_alert.status = 'ACKNOWLEDGED' THEN
        RETURN jsonb_build_object('success', true, 'message', 'Alert already acknowledged', 'alert', to_jsonb(v_alert));
    END IF;

    -- Atomic update + audit in single transaction
    UPDATE public.alerts
    SET status = 'ACKNOWLEDGED', acknowledged_by = p_user_id, acknowledged_at = now()
    WHERE id = p_alert_id;

    INSERT INTO public.audit_logs (
        organisation_id, site_id, actor_id, actor_role, action, entity_type, entity_id, details
    ) VALUES (
        p_org_id, v_alert.site_id, p_user_id, p_user_role, 'ALERT_ACKNOWLEDGED', 'ALERT', p_alert_id::text,
        jsonb_build_object(
            'alert_title', v_alert.title,
            'severity', v_alert.severity,
            'module', v_alert.module
        )
    );

    RETURN jsonb_build_object('success', true, 'message', 'Alert acknowledged and audited');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.acknowledge_dsm_incident_atomic(
    p_incident_id UUID,
    p_site_id UUID,
    p_user_id UUID,
    p_user_role VARCHAR(50),
    p_org_id UUID
)
RETURNS JSONB AS $$
DECLARE
    v_incident RECORD;
BEGIN
    p_user_role := public.assert_actor_authority(p_user_id,p_org_id,ARRAY['ORGANISATION_ADMIN','ENERGY_MANAGER','OPERATOR'],p_site_id);
    -- Security Check: Only service_role or postgres
    IF current_setting('role', true) != 'service_role' AND CURRENT_USER != 'postgres' THEN
        RAISE EXCEPTION 'PERMISSION DENIED: Incident acknowledgement requires service-role.';
    END IF;

    -- Fetch incident to verify it exists and get details
    SELECT * INTO v_incident
    FROM public.dsm_incidents
    WHERE id = p_incident_id AND site_id = p_site_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'INCIDENT_NOT_FOUND: DSM incident % not found for site %', p_incident_id, p_site_id;
    END IF;

    IF v_incident.acknowledged THEN
        RETURN jsonb_build_object('success', true, 'message', 'Incident already acknowledged', 'incident', to_jsonb(v_incident));
    END IF;

    -- Atomic update + audit in single transaction
    UPDATE public.dsm_incidents
    SET acknowledged = true, acknowledged_by = p_user_id, acknowledged_at = now()
    WHERE id = p_incident_id;

    INSERT INTO public.audit_logs (
        organisation_id, site_id, actor_id, actor_role, action, entity_type, entity_id, details
    ) VALUES (
        p_org_id, p_site_id, p_user_id, p_user_role, 'DSM_INCIDENT_ACKNOWLEDGED', 'DSM_INCIDENT', p_incident_id::text,
        jsonb_build_object(
            'severity', v_incident.severity,
            'start_block', v_incident.start_block,
            'end_block', v_incident.end_block,
            'max_deviation_pct', v_incident.max_deviation_pct,
            'total_excess_energy_kwh', v_incident.total_excess_energy_kwh,
            'estimated_exposure_inr', v_incident.estimated_exposure_inr
        )
    );

    RETURN jsonb_build_object('success', true, 'message', 'DSM incident acknowledged and audited');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
-- Cancellation is a durable intent followed by provider acknowledgement and atomic completion.
CREATE TABLE public.billing_cancellation_requests (
  subscription_id uuid PRIMARY KEY REFERENCES public.subscriptions(id),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id),
  actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
  provider_reference text NOT NULL,
  provider_mode text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','COMPLETED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE public.billing_cancellation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_cancellation_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.billing_cancellation_requests TO service_role;

CREATE FUNCTION public.prepare_subscription_cancellation(p_subscription_id uuid, p_org_id uuid, p_actor_id uuid, p_provider_mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE s public.subscriptions; r public.billing_cancellation_requests; v_role text; v_mode text;
BEGIN
  v_role := public.assert_actor_authority(p_actor_id,p_org_id,ARRAY['ORGANISATION_ADMIN']);
  SELECT * INTO s FROM public.subscriptions WHERE id=p_subscription_id AND organisation_id=p_org_id FOR UPDATE;
  IF NOT FOUND OR s.billing_provider_ref IS NULL THEN RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND'; END IF;
  IF (s.billing_provider='RAZORPAY' AND p_provider_mode='MOCK_DEVELOPMENT') OR
     (s.billing_provider='MOCK' AND p_provider_mode <> 'MOCK_DEVELOPMENT') THEN RAISE EXCEPTION 'PROVIDER_MODE_MISMATCH'; END IF;
  SELECT provider_mode INTO v_mode FROM public.billing_checkout_sessions WHERE provider_reference=s.billing_provider_ref AND organisation_id=p_org_id;
  IF v_mode IS NOT NULL AND v_mode IS DISTINCT FROM p_provider_mode THEN RAISE EXCEPTION 'PROVIDER_MODE_MISMATCH'; END IF;
  SELECT * INTO r FROM public.billing_cancellation_requests WHERE subscription_id=s.id;
  IF FOUND THEN
    IF r.provider_reference IS DISTINCT FROM s.billing_provider_ref OR r.provider_mode IS DISTINCT FROM p_provider_mode THEN
      RAISE EXCEPTION 'PROVIDER_REFERENCE_MISMATCH';
    END IF;
    RETURN to_jsonb(r);
  END IF;
  INSERT INTO public.billing_cancellation_requests(subscription_id,organisation_id,actor_id,provider_reference,provider_mode)
    VALUES(s.id,p_org_id,p_actor_id,s.billing_provider_ref,p_provider_mode) RETURNING * INTO r;
  INSERT INTO public.audit_logs(organisation_id,actor_id,actor_role,action,entity_type,entity_id,details)
    VALUES(p_org_id,p_actor_id,v_role,'SUBSCRIPTION_CANCELLATION_REQUESTED','SUBSCRIPTION',s.id::text,
      jsonb_build_object('provider_reference',s.billing_provider_ref,'provider_mode',p_provider_mode));
  RETURN to_jsonb(r);
END $$;

CREATE OR REPLACE FUNCTION public.cancel_subscription_atomic(
  p_subscription_id uuid, p_org_id uuid, p_actor_id uuid, p_actor_role text,
  p_provider_mode text, p_product_id text, p_force_audit_failure boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE s public.subscriptions; r public.billing_cancellation_requests;
BEGIN
  PERFORM public.assert_backend_caller();
  SELECT * INTO s FROM public.subscriptions WHERE id=p_subscription_id AND organisation_id=p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND'; END IF;
  SELECT * INTO r FROM public.billing_cancellation_requests WHERE subscription_id=s.id FOR UPDATE;
  IF NOT FOUND OR r.organisation_id IS DISTINCT FROM p_org_id OR r.actor_id IS DISTINCT FROM p_actor_id OR
    r.provider_mode IS DISTINCT FROM p_provider_mode OR r.provider_reference IS DISTINCT FROM s.billing_provider_ref THEN
    RAISE EXCEPTION 'CANCELLATION_INTENT_REQUIRED';
  END IF;
  IF r.status='COMPLETED' THEN RETURN to_jsonb(s); END IF;
  UPDATE public.subscriptions SET cancel_at_period_end=true,updated_at=now() WHERE id=s.id RETURNING * INTO s;
  UPDATE public.billing_cancellation_requests SET status='COMPLETED',completed_at=now() WHERE subscription_id=s.id;
  IF p_force_audit_failure THEN RAISE EXCEPTION 'FORCED_AUDIT_FAILURE_ROLLBACK'; END IF;
  INSERT INTO public.audit_logs(organisation_id,actor_id,actor_role,action,entity_type,entity_id,details)
    VALUES(p_org_id,r.actor_id,'ORGANISATION_ADMIN','SUBSCRIPTION_CANCELLED','SUBSCRIPTION',s.id::text,
      jsonb_build_object('provider_reference',r.provider_reference,'provider_mode',r.provider_mode,'cancel_at_period_end',true));
  RETURN to_jsonb(s);
END $$;

CREATE OR REPLACE FUNCTION public.process_razorpay_webhook_atomic(
 p_event_id varchar(255), p_event_type varchar(100), p_payload jsonb, p_org_id uuid,
 p_site_id uuid, p_product_id varchar(50), p_provider_ref varchar(255), p_amount_paise bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE c public.billing_checkout_sessions; v_payment jsonb; v_ref text; v_error text;
 v_sub uuid; v_event_status text; v_until timestamptz := now()+interval '30 days';
BEGIN
  PERFORM public.assert_backend_caller();
  IF p_event_id IS NULL OR p_event_id='' THEN RAISE EXCEPTION 'INVALID_EVENT_ID'; END IF;
  -- A conflicting INSERT waits for the winner to commit before any state mutation.
  INSERT INTO public.processed_webhook_events(id,provider,event_type,payload,status)
    VALUES(p_event_id,'RAZORPAY',p_event_type,p_payload,'PROCESSING') ON CONFLICT(id) DO NOTHING;
  IF NOT FOUND THEN
    SELECT status INTO v_event_status FROM public.processed_webhook_events WHERE id=p_event_id;
    RETURN jsonb_build_object('status',CASE WHEN v_event_status='QUARANTINED' THEN 'QUARANTINED' ELSE 'already_processed' END,
      'quarantined',v_event_status='QUARANTINED','idempotent_replay',true);
  END IF;
  v_payment := p_payload #> '{payload,payment,entity}';
  v_ref := v_payment->>'order_id';
  SELECT * INTO c FROM public.billing_checkout_sessions WHERE provider_reference=v_ref FOR UPDATE;
  IF NOT FOUND OR v_ref IS DISTINCT FROM p_provider_ref THEN v_error := 'UNKNOWN_PROVIDER_REFERENCE';
  ELSIF p_payload->>'event' IS DISTINCT FROM p_event_type OR p_event_type NOT IN ('payment.captured','order.paid','payment.failed') THEN v_error := 'UNSUPPORTED_EVENT';
  ELSIF c.provider_mode <> 'RAZORPAY_LIVE' AND NOT (c.provider_mode='RAZORPAY_TEST' AND
    EXISTS(SELECT 1 FROM public.sites WHERE id=c.site_id AND organisation_id=c.organisation_id AND is_demo)) THEN v_error := 'NON_LIVE_PAYMENT';
  ELSIF c.site_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sites WHERE id=c.site_id AND organisation_id=c.organisation_id) THEN v_error := 'SITE_ORGANISATION_MISMATCH';
  ELSIF COALESCE(v_payment->>'id','') !~ '^pay_[a-zA-Z0-9_]+$' OR
    v_payment->>'currency' IS DISTINCT FROM 'INR' OR
    v_payment->'amount' IS DISTINCT FROM to_jsonb(c.amount_paise) THEN v_error := 'PAYMENT_FACTS_MISMATCH';
  ELSIF p_event_type IN ('payment.captured','order.paid') AND
    (v_payment->>'status' IS DISTINCT FROM 'captured' OR v_payment->'captured' IS DISTINCT FROM 'true'::jsonb) THEN v_error := 'PAYMENT_NOT_CAPTURED';
  ELSIF p_event_type='payment.failed' AND v_payment->>'status' IS DISTINCT FROM 'failed' THEN v_error := 'PAYMENT_STATUS_MISMATCH';
  ELSIF c.status IN ('CANCELLED','EXPIRED') THEN v_error := 'CHECKOUT_CLOSED';
  END IF;
  IF v_error IS NOT NULL THEN
    UPDATE public.processed_webhook_events SET status='QUARANTINED' WHERE id=p_event_id;
    RETURN jsonb_build_object('status','QUARANTINED','quarantined',true,'error',v_error);
  END IF;
  -- Deduplicate by paid order as well as event ID: payment.captured and order.paid
  -- describe the same payment. Changed unsigned delivery headers cannot renew access.
  IF c.status='PAID' THEN
    UPDATE public.processed_webhook_events SET status='PROCESSED' WHERE id=p_event_id;
    RETURN jsonb_build_object('status','already_processed','idempotent_replay',true);
  END IF;
  IF p_event_type='payment.failed' THEN
    UPDATE public.billing_checkout_sessions SET status='FAILED' WHERE id=c.id;
    INSERT INTO public.invoices(organisation_id,invoice_number,amount_paise,tax_paise,total_paise,status)
      VALUES(c.organisation_id,'INV-FAIL-'||c.id::text,c.amount_paise,0,c.amount_paise,'FAILED') ON CONFLICT(invoice_number) DO NOTHING;
  ELSE
    UPDATE public.billing_checkout_sessions SET status='PAID' WHERE id=c.id;
    INSERT INTO public.subscriptions(organisation_id,billing_provider,billing_provider_ref,status,current_period_start,current_period_end)
      VALUES(c.organisation_id,'RAZORPAY',c.provider_reference,'ACTIVE',now(),v_until) RETURNING id INTO v_sub;
    INSERT INTO public.subscription_items(subscription_id,product_id,site_id,unit_price_paise,quantity)
      VALUES(v_sub,c.product_id,c.site_id,c.amount_paise,1);
    INSERT INTO public.entitlements(organisation_id,product_id,site_id,is_active,valid_from,valid_until,granted_by)
      VALUES(c.organisation_id,c.product_id,c.site_id,true,now(),v_until,'RAZORPAY_WEBHOOK')
      ON CONFLICT ON CONSTRAINT uq_entitlements_org_product_site DO UPDATE SET is_active=true,
        valid_from=LEAST(entitlements.valid_from,EXCLUDED.valid_from),
        valid_until=GREATEST(entitlements.valid_until,EXCLUDED.valid_until),granted_by=EXCLUDED.granted_by;
    INSERT INTO public.invoices(organisation_id,subscription_id,invoice_number,amount_paise,tax_paise,total_paise,status,paid_at)
      VALUES(c.organisation_id,v_sub,'INV-'||c.id::text,c.amount_paise,0,c.amount_paise,'PAID',now());
  END IF;
  INSERT INTO public.audit_logs(organisation_id,site_id,actor_role,action,entity_type,entity_id,details)
    VALUES(c.organisation_id,c.site_id,'SYSTEM','BILLING_WEBHOOK_PROCESSED','CHECKOUT',c.id::text,
      jsonb_build_object('event_id',p_event_id,'event_type',p_event_type,'provider_reference',c.provider_reference,'amount_paise',c.amount_paise));
  UPDATE public.processed_webhook_events SET status='PROCESSED' WHERE id=p_event_id;
  RETURN jsonb_build_object('success',true,'status','PROCESSED','subscription_id',v_sub);
END $$;

-- Report rows contain the complete exported summary: direct SELECT must enforce entitlement too.
DROP POLICY IF EXISTS "Users can view reports for permitted sites or org-wide" ON public.report_records;
CREATE POLICY "Entitled users read tenant reports" ON public.report_records FOR SELECT TO authenticated USING (
  public.is_platform_admin() OR (
    public.is_org_member(organisation_id) AND (site_id IS NULL OR public.has_site_access(site_id)) AND
    EXISTS (SELECT 1 FROM public.entitlements e WHERE e.organisation_id=report_records.organisation_id
      AND (e.site_id IS NULL OR e.site_id=report_records.site_id) AND e.is_active AND e.valid_from <= now()
      AND (e.valid_until IS NULL OR e.valid_until > now()) AND e.product_id = CASE report_records.module
        WHEN 'GRID' THEN 'GRID_INTELLIGENCE' WHEN 'DSM' THEN 'DSM_RISK' WHEN 'BESS' THEN 'BESS_ARBITRAGE'
        WHEN 'COMPLIANCE' THEN 'OA_COMPLIANCE' WHEN 'RENEWABLE' THEN 'RENEWABLE_PORTFOLIO' END)));
DROP POLICY IF EXISTS "Members can view entitlements" ON public.entitlements;
CREATE POLICY "Members read permitted entitlements" ON public.entitlements FOR SELECT TO authenticated USING (
  public.is_platform_admin() OR (public.is_org_member(organisation_id) AND (site_id IS NULL OR public.has_site_access(site_id))));

-- Membership, invitation and grant maintenance must also be audited when performed by
-- trusted administration jobs rather than an HTTP route. Trigger failure aborts the write.
CREATE FUNCTION public.audit_tenant_authority_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_row jsonb; v_before jsonb; v_org uuid; v_site uuid;
BEGIN
  IF TG_OP='UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  IF TG_OP='DELETE' THEN v_row := to_jsonb(OLD); ELSE v_row := to_jsonb(NEW); END IF;
  IF TG_OP <> 'INSERT' THEN v_before := to_jsonb(OLD) - 'token' - 'token_hash'; END IF;
  v_org := (v_row->>'organisation_id')::uuid;
  v_site := (v_row->>'site_id')::uuid;
  IF TG_TABLE_NAME='site_access' THEN SELECT organisation_id INTO v_org FROM public.sites WHERE id=v_site; END IF;
  INSERT INTO public.audit_logs(organisation_id,site_id,actor_id,actor_role,action,entity_type,entity_id,details)
    VALUES(v_org,v_site,auth.uid(),COALESCE(auth.role(),'SYSTEM'),upper(TG_TABLE_NAME)||'_'||TG_OP,
      upper(TG_TABLE_NAME),v_row->>'id',jsonb_build_object('before',v_before,'after',
        CASE WHEN TG_OP='DELETE' THEN NULL ELSE v_row - 'token' - 'token_hash' END));
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER audit_membership_mutation AFTER INSERT OR UPDATE OR DELETE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.audit_tenant_authority_change();
CREATE TRIGGER audit_invitation_mutation AFTER INSERT OR UPDATE OR DELETE ON public.organisation_invitations
  FOR EACH ROW EXECUTE FUNCTION public.audit_tenant_authority_change();
CREATE TRIGGER audit_site_grant_mutation AFTER INSERT OR UPDATE OR DELETE ON public.site_access
  FOR EACH ROW EXECUTE FUNCTION public.audit_tenant_authority_change();

-- Harden every application definer, including trigger functions replaced by earlier migrations.
-- Explicit pg_temp last prevents implicit temporary relation lookup before public.
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature, p.proname FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, public, pg_temp',f.signature);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
    IF f.proname = ANY(ARRAY['is_org_member','has_org_role','is_platform_admin','has_site_access',
      'is_internal_aetheon_user','is_aetheon_analyst','is_regulatory_reviewer']) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated',f.signature);
    END IF;
  END LOOP;
END $$;
ALTER TABLE public.organisation_invitations VALIDATE CONSTRAINT invitation_site_org_fk;
ALTER TABLE public.billing_checkout_sessions VALIDATE CONSTRAINT checkout_site_org_fk;
ALTER TABLE public.entitlements VALIDATE CONSTRAINT entitlement_site_org_fk;
ALTER TABLE public.report_records VALIDATE CONSTRAINT report_site_org_fk;
ALTER TABLE public.audit_logs VALIDATE CONSTRAINT audit_site_org_fk;
NOTIFY pgrst, 'reload schema';
COMMIT;
