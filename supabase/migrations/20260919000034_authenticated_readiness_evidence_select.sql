BEGIN;

-- Existing site-scoped SELECT policies enforce has_site_access(site_id).
-- Production lacks the base table privilege needed to reach those policies.
GRANT SELECT ON TABLE
  public.data_quality_evaluations,
  public.renewable_assets,
  public.bess_assets
TO authenticated;

COMMIT;
