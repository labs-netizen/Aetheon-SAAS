BEGIN;

-- RLS remains authoritative for tenant/site visibility. This base privilege
-- only permits authenticated requests to reach the existing SELECT policy.
GRANT SELECT ON TABLE public.interval_data_96 TO authenticated;

COMMIT;
