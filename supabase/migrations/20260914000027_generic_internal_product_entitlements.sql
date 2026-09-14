BEGIN;

-- Required production catalogue records. Local seed data is not run by hosted
-- migration deployment, so insert only missing products and preserve all
-- existing commercial configuration unchanged.
INSERT INTO public.products (
    id,
    name,
    description,
    base_price_paise,
    billing_interval,
    availability_status
) VALUES
    ('GRID_INTELLIGENCE', 'Grid Intelligence Monitor', '96-block price/demand forecast, Daily Grid Brief, and peak cost avoidance.', 1990000, 'MONTHLY', 'INTERNAL_VALIDATION'),
    ('OA_COMPLIANCE', 'Open Access Compliance Sentinel', 'Statutory compliance tracking, DISCOM charge calculation (CSS/AS), and SLDC calendar.', 1490000, 'MONTHLY', 'SPECIALIST_REVIEW_REQUIRED'),
    ('DSM_RISK', 'DSM Risk Monitor', 'Continuous 15-minute deviation tracking and regulatory exposure calculation under CERC rules.', 2990000, 'MONTHLY', 'INTERNAL_VALIDATION'),
    ('BESS_ARBITRAGE', 'BESS Arbitrage Signals', 'Advisory charge/discharge opportunity window recommendations for C&I batteries.', 4990000, 'MONTHLY', 'SPECIALIST_REVIEW_REQUIRED'),
    ('RENEWABLE_PORTFOLIO', 'Renewable Portfolio Monitor', 'Generation reconciliation (measured/modelled/estimated) and carbon avoidance ledger.', 2490000, 'MONTHLY', 'DEMO')
ON CONFLICT (id) DO NOTHING;

REVOKE ALL ON FUNCTION public.grant_internal_grid_entitlement(uuid, uuid, text, timestamptz, text)
FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION public.grant_internal_grid_entitlement(uuid, uuid, text, timestamptz, text);

CREATE FUNCTION public.grant_internal_product_entitlement(
    p_org_id uuid,
    p_site_id uuid,
    p_product_id varchar(50),
    p_source text,
    p_valid_until timestamptz,
    p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_product public.products;
    v_entitlement public.entitlements;
BEGIN
    PERFORM public.assert_backend_caller();
    IF p_source NOT IN ('INTERNAL_TEST', 'TRIAL') THEN
        RAISE EXCEPTION 'INVALID_INTERNAL_ENTITLEMENT_SOURCE' USING ERRCODE = '22023';
    END IF;
    IF p_valid_until IS NULL OR p_valid_until <= now() OR p_valid_until > now() + interval '90 days' THEN
        RAISE EXCEPTION 'INVALID_INTERNAL_ENTITLEMENT_EXPIRY' USING ERRCODE = '22023';
    END IF;
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'INTERNAL_ENTITLEMENT_REASON_REQUIRED' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.sites s
        JOIN public.organisations o ON o.id = s.organisation_id
        WHERE s.id = p_site_id AND s.organisation_id = p_org_id
          AND s.is_demo = false AND o.is_active = true
    ) THEN
        RAISE EXCEPTION 'SITE_ORGANISATION_MISMATCH' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_product FROM public.products WHERE id = p_product_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRODUCT_CATALOG_ENTRY_NOT_FOUND: %', p_product_id USING ERRCODE = '23503';
    END IF;
    IF v_product.availability_status IN ('DEVELOPMENT', 'RETIRED') THEN
        RAISE EXCEPTION 'PRODUCT_NOT_ACTIVE_FOR_INTERNAL_ENTITLEMENT: %', p_product_id USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_entitlement FROM public.entitlements
    WHERE organisation_id = p_org_id AND product_id = v_product.id AND site_id = p_site_id
    FOR UPDATE;

    IF FOUND AND v_entitlement.granted_by NOT IN ('INTERNAL_TEST', 'TRIAL') THEN
        RETURN jsonb_build_object('status', 'COMMERCIAL_PRESERVED', 'entitlement_id', v_entitlement.id,
            'product_id', v_entitlement.product_id, 'site_id', v_entitlement.site_id);
    END IF;

    IF v_entitlement.id IS NULL THEN
        INSERT INTO public.entitlements (organisation_id, product_id, site_id, is_active, valid_from, valid_until, granted_by)
        VALUES (p_org_id, v_product.id, p_site_id, true, now(), p_valid_until, p_source)
        RETURNING * INTO v_entitlement;
    ELSE
        UPDATE public.entitlements SET is_active = true, valid_from = now(), valid_until = p_valid_until, granted_by = p_source
        WHERE id = v_entitlement.id RETURNING * INTO v_entitlement;
    END IF;

    INSERT INTO public.audit_logs (organisation_id, site_id, actor_id, actor_role, action, entity_type, entity_id, details)
    VALUES (p_org_id, p_site_id, NULL, 'INTERNAL_ADMINISTRATION', 'INTERNAL_PRODUCT_ENTITLEMENT_GRANTED',
        'ENTITLEMENT', v_entitlement.id::text, jsonb_build_object('source', p_source, 'product_id', v_product.id,
        'valid_until', p_valid_until, 'reason', btrim(p_reason)));

    RETURN jsonb_build_object('status', 'INTERNAL_GRANTED', 'entitlement_id', v_entitlement.id,
        'product_id', v_entitlement.product_id, 'site_id', v_entitlement.site_id, 'valid_until', v_entitlement.valid_until);
END;
$$;

CREATE FUNCTION public.grant_internal_all_product_entitlements(
    p_org_id uuid,
    p_site_id uuid,
    p_source text,
    p_valid_until timestamptz,
    p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_product public.products;
    v_result jsonb;
    v_results jsonb := '[]'::jsonb;
    v_expected_ids varchar(50)[] := ARRAY['GRID_INTELLIGENCE', 'OA_COMPLIANCE', 'DSM_RISK', 'BESS_ARBITRAGE', 'RENEWABLE_PORTFOLIO'];
    v_expected_count integer;
BEGIN
    PERFORM public.assert_backend_caller();
    SELECT count(*) INTO v_expected_count FROM public.products
    WHERE id = ANY(v_expected_ids)
      AND availability_status IN ('DEMO', 'INTERNAL_VALIDATION', 'SPECIALIST_REVIEW_REQUIRED', 'AVAILABLE', 'DEGRADED');
    IF v_expected_count <> cardinality(v_expected_ids) THEN
        RAISE EXCEPTION 'EXPECTED_PRODUCT_CATALOG_INCOMPLETE' USING ERRCODE = '23503';
    END IF;

    FOR v_product IN SELECT * FROM public.products
        WHERE availability_status IN ('DEMO', 'INTERNAL_VALIDATION', 'SPECIALIST_REVIEW_REQUIRED', 'AVAILABLE', 'DEGRADED') ORDER BY id
    LOOP
        v_result := public.grant_internal_product_entitlement(p_org_id, p_site_id, v_product.id, p_source, p_valid_until, p_reason);
        v_results := v_results || jsonb_build_array(v_result);
    END LOOP;
    IF jsonb_array_length(v_results) = 0 THEN
        RAISE EXCEPTION 'ACTIVE_PRODUCT_CATALOG_EMPTY' USING ERRCODE = '23503';
    END IF;
    RETURN jsonb_build_object('status', 'COMPLETED', 'entitlements', v_results);
END;
$$;

REVOKE ALL ON FUNCTION public.grant_internal_product_entitlement(uuid, uuid, varchar, text, timestamptz, text)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_internal_all_product_entitlements(uuid, uuid, text, timestamptz, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_internal_product_entitlement(uuid, uuid, varchar, text, timestamptz, text)
TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.grant_internal_all_product_entitlements(uuid, uuid, text, timestamptz, text)
TO service_role, postgres;

NOTIFY pgrst, 'reload schema';
COMMIT;
