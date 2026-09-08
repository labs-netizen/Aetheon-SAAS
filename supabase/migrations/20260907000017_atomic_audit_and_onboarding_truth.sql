-- Aetheon Energy Intelligence Platform - Migration 17: Atomic Audit & Onboarding Truth
-- 1. Atomic RPCs for critical business mutations + audit logging (transactional rollback on audit failure)
-- 2. Revoke PUBLIC/anon/authenticated execute; grant service_role only
-- 3. Update handle_new_user() to prevent non-demo configuration fabrication

-- ----------------------------------------------------------------------------
-- 1. Atomic Site Configuration Update + Audit
-- ----------------------------------------------------------------------------
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

REVOKE ALL ON FUNCTION public.update_site_config_atomic(UUID, JSONB, UUID, TEXT, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_site_config_atomic(UUID, JSONB, UUID, TEXT, UUID, BOOLEAN) TO service_role;

-- ----------------------------------------------------------------------------
-- 2. Atomic Invitation Creation + Audit
-- ----------------------------------------------------------------------------
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

REVOKE ALL ON FUNCTION public.create_invitation_atomic(UUID, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_invitation_atomic(UUID, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, UUID, TEXT, BOOLEAN) TO service_role;

-- ----------------------------------------------------------------------------
-- 3. Atomic Subscription Cancellation + Audit
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_subscription_atomic(
    p_subscription_id UUID,
    p_org_id UUID,
    p_actor_id UUID,
    p_actor_role TEXT,
    p_provider_mode TEXT,
    p_product_id TEXT,
    p_force_audit_failure BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_sub RECORD;
    v_audit_details JSONB;
BEGIN
    UPDATE public.subscriptions
    SET
        cancel_at_period_end = true,
        updated_at = now()
    WHERE id = p_subscription_id AND organisation_id = p_org_id
    RETURNING * INTO v_sub;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND';
    END IF;

    -- Forced audit failure hook for transactional rollback proving
    IF p_force_audit_failure THEN
        RAISE EXCEPTION 'FORCED_AUDIT_FAILURE_ROLLBACK';
    END IF;

    v_audit_details := jsonb_build_object(
        'product_id', p_product_id,
        'cancel_at_period_end', true,
        'provider_mode', p_provider_mode
    );

    INSERT INTO public.audit_logs (
        organisation_id,
        actor_id,
        actor_role,
        action,
        entity_type,
        entity_id,
        details
    ) VALUES (
        p_org_id,
        p_actor_id,
        COALESCE(p_actor_role, 'ORGANISATION_ADMIN'),
        'SUBSCRIPTION_CANCELLED',
        'SUBSCRIPTION',
        p_subscription_id::text,
        v_audit_details
    );

    RETURN to_jsonb(v_sub);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_subscription_atomic(UUID, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_subscription_atomic(UUID, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN) TO service_role;

-- ----------------------------------------------------------------------------
-- 4. Registration Trigger: Prevent Non-Demo Electrical Fabrication
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
      v_state := new.raw_user_meta_data->>'state';
      v_discom := new.raw_user_meta_data->>'discom';
      v_voltage := new.raw_user_meta_data->>'voltage_category';
      v_metering := new.raw_user_meta_data->>'metering_point';
      v_demand := (new.raw_user_meta_data->>'contract_demand_value')::numeric;
      v_unit := COALESCE(new.raw_user_meta_data->>'contract_demand_unit', 'kVA');

      IF v_site_name IS NOT NULL AND length(trim(v_site_name)) > 0 AND
         v_state IS NOT NULL AND v_discom IS NOT NULL AND
         v_voltage IS NOT NULL AND v_metering IS NOT NULL AND
         v_demand IS NOT NULL AND v_demand > 0 THEN

        INSERT INTO public.sites (
          organisation_id, name, state, discom, voltage_category, 
          contract_demand_value, contract_demand_unit, metering_point, 
          load_class, timezone, activation_status, activation_reason, is_demo
        ) VALUES (
          v_org_id,
          trim(v_site_name),
          trim(v_state),
          trim(v_discom),
          trim(v_voltage),
          v_demand,
          v_unit,
          trim(v_metering),
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
