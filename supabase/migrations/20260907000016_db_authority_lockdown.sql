-- Migration 16: Database Authority Lockdown
-- 1. Eliminate direct site update bypass from customer sessions (sites table)
-- 2. Eliminate direct interval insert bypass from customer sessions (interval_data_96 table)
-- 3. Eliminate direct BESS asset mutation from customer sessions (bess_assets table)

-- 1. Sites Table: Customer accounts must update through /api/sites/[id] server route only.
DROP POLICY IF EXISTS "Org admins can manage all sites; Energy managers can update permitted sites" ON public.sites;
DROP POLICY IF EXISTS "Org admins can manage all sites; Energy managers can update per" ON public.sites;

CREATE POLICY "Server only update sites" ON public.sites
    FOR UPDATE
    USING (
        is_platform_admin() 
        OR (auth.role() = 'service_role')
        OR (CURRENT_USER = 'postgres')
    )
    WITH CHECK (
        is_platform_admin() 
        OR (auth.role() = 'service_role')
        OR (CURRENT_USER = 'postgres')
    );

-- 2. Interval Data 96: Purge any surviving customer insert policies. Server-only ingestion.
DROP POLICY IF EXISTS "Energy Managers and Org Admins can insert interval data for permitted sites" ON public.interval_data_96;
DROP POLICY IF EXISTS "Energy Managers and Org Admins can insert interval data for per" ON public.interval_data_96;
DROP POLICY IF EXISTS "Energy Managers and Org Admins can insert interval data for permitted " ON public.interval_data_96;

-- 3. BESS Assets: Writes are server/internal only. Customers retain permitted SELECT.
DROP POLICY IF EXISTS "Energy Managers and Org Admins can manage bess assets" ON public.bess_assets;
DROP POLICY IF EXISTS "Energy Managers and Org Admins can manage bess" ON public.bess_assets;

CREATE POLICY "Server only write bess assets" ON public.bess_assets
    FOR ALL
    USING (
        is_platform_admin() 
        OR (auth.role() = 'service_role')
        OR (CURRENT_USER = 'postgres')
    )
    WITH CHECK (
        is_platform_admin() 
        OR (auth.role() = 'service_role')
        OR (CURRENT_USER = 'postgres')
    );
