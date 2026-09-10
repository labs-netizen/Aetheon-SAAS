BEGIN;

-- Browser tenancy bootstrap reads these tables as the authenticated user.
-- Row visibility remains constrained by the existing RLS policies.
GRANT SELECT ON TABLE
    public.organisations,
    public.entitlements,
    public.sites
TO authenticated;

COMMIT;
