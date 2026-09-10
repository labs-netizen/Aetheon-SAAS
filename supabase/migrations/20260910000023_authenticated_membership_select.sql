BEGIN;

-- Post-login tenancy resolution reads memberships through the authenticated client.
-- RLS remains authoritative for row visibility; this grants only table-level SELECT.
GRANT SELECT ON TABLE public.memberships TO authenticated;

COMMIT;
