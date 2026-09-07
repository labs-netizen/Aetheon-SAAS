'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import type { Organisation, Site, PlatformRole } from '@/types';
import { createClient } from '@/lib/supabase/client';

export type TenancyStatus =
  | 'LOADING'
  | 'READY'
  | 'NO_ORGANISATION'
  | 'ONBOARDING_REQUIRED'
  | 'ACCESS_DENIED'
  | 'ERROR';

export interface SiteContextValue {
  currentOrg: Organisation | null;
  currentSite: Site | null;
  activeRole: PlatformRole;
  sites: Site[];
  entitlements: string[];
  isEntitled: (productId: string) => boolean;
  isLoading: boolean;
  tenancyStatus: TenancyStatus;
  errorMessage: string | null;
  switchSite: (siteId: string) => void;
  switchRole: (role: PlatformRole) => void;
  refreshSites: () => Promise<void>;
}

const DEMO_ORG: Organisation = {
  id: 'a0000000-0000-0000-0000-000000000001',
  name: 'Aetheon Demo Industries Pvt Ltd',
  legal_entity_name: 'Aetheon Demo Industries Private Limited',
  gstin: '27AABCA1234F1Z5',
  is_active: true,
  created_at: '2026-09-01T00:00:00Z',
};

const DEMO_SITES: Site[] = [
  {
    id: 'b0000000-0000-0000-0000-000000000001',
    organisation_id: 'a0000000-0000-0000-0000-000000000001',
    name: 'Aetheon Demo Manufacturing Facility 1',
    state: 'Maharashtra',
    discom: 'MSEDCL',
    voltage_category: '33kV',
    contract_demand_value: 2500,
    contract_demand_unit: 'kVA',
    metering_point: 'Main Substation Incomer Feeder 1',
    load_class: 'Continuous Process Industrial',
    timezone: 'Asia/Kolkata',
    activation_status: 'ACTIVE',
    activation_reason: 'Calibrated on 30-day historical interval dataset (DEMO)',
    last_status_change: '2026-09-01T00:00:00Z',
    is_demo: true,
  },
  {
    id: 'b0000000-0000-0000-0000-000000000002',
    organisation_id: 'a0000000-0000-0000-0000-000000000001',
    name: 'Aetheon Demo Engineering Unit 2',
    state: 'Gujarat',
    discom: 'UGVCL',
    voltage_category: '66kV',
    contract_demand_value: 4000,
    contract_demand_unit: 'kVA',
    metering_point: 'HT Substation 2',
    load_class: 'Heavy Engineering',
    timezone: 'Asia/Kolkata',
    activation_status: 'AWAITING_DATA',
    activation_reason: 'Awaiting initial 15-minute AMR load upload',
    last_status_change: '2026-09-05T00:00:00Z',
    is_demo: true,
  },
];

const ALL_PRODUCT_ENTITLEMENTS = [
  'GRID_INTELLIGENCE',
  'OA_COMPLIANCE',
  'DSM_RISK',
  'BESS_ARBITRAGE',
  'RENEWABLE_PORTFOLIO',
];

const SiteContext = createContext<SiteContextValue | undefined>(undefined);

export function SiteProvider({ children }: { children: React.ReactNode }) {
  const isDemo = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

  const [currentOrg, setCurrentOrg] = useState<Organisation | null>(isDemo ? DEMO_ORG : null);
  const [sites, setSites] = useState<Site[]>(isDemo ? DEMO_SITES : []);
  const [currentSiteId, setCurrentSiteId] = useState<string>(isDemo ? DEMO_SITES[0].id : '');
  const [entitlements, setEntitlements] = useState<string[]>(isDemo ? ALL_PRODUCT_ENTITLEMENTS : []);
  const [activeRole, setActiveRole] = useState<PlatformRole>('ORGANISATION_ADMIN');
  const [isLoading, setIsLoading] = useState<boolean>(!isDemo);
  const [tenancyStatus, setTenancyStatus] = useState<TenancyStatus>(isDemo ? 'READY' : 'LOADING');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const supabase = createClient();

  const loadUserData = React.useCallback(async () => {
    if (isDemo) {
      setCurrentOrg(DEMO_ORG);
      setSites(DEMO_SITES);
      setCurrentSiteId(DEMO_SITES[0].id);
      setEntitlements(ALL_PRODUCT_ENTITLEMENTS);
      setTenancyStatus('READY');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        setCurrentOrg(null);
        setSites([]);
        setEntitlements([]);
        setTenancyStatus('ACCESS_DENIED');
        setIsLoading(false);
        return;
      }

      // Query user memberships and organization
      const { data: membershipData, error: memError } = await supabase
        .from('memberships')
        .select(`
          role,
          is_active,
          organisation_id,
          organisations:organisation_id (
            id,
            name,
            legal_entity_name,
            gstin,
            is_active,
            created_at
          )
        `)
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();

      if (memError) {
        setCurrentOrg(null);
        setSites([]);
        setEntitlements([]);
        setErrorMessage(memError.message);
        setTenancyStatus('ERROR');
        setIsLoading(false);
        return;
      }

      if (!membershipData || !membershipData.organisations) {
        setCurrentOrg(null);
        setSites([]);
        setEntitlements([]);
        setTenancyStatus('NO_ORGANISATION');
        setIsLoading(false);
        return;
      }

      if (membershipData.is_active === false) {
        setCurrentOrg(null);
        setSites([]);
        setEntitlements([]);
        setTenancyStatus('ACCESS_DENIED');
        setIsLoading(false);
        return;
      }

      const org = Array.isArray(membershipData.organisations)
        ? membershipData.organisations[0]
        : membershipData.organisations;

      setCurrentOrg(org as unknown as Organisation);
      if (membershipData.role) {
        setActiveRole(membershipData.role as PlatformRole);
      }

      // Query entitlements for this organisation
      const { data: entData } = await supabase
        .from('entitlements')
        .select('product_id, is_active')
        .eq('organisation_id', org.id)
        .eq('is_active', true);

      if (entData) {
        const activeIds = entData.map((e) => e.product_id);
        setEntitlements(activeIds);
      }

      // Query sites for this organisation
      const { data: sitesData, error: sitesError } = await supabase
        .from('sites')
        .select('*')
        .eq('organisation_id', org.id);

      if (sitesError) {
        setErrorMessage(sitesError.message);
        setTenancyStatus('ERROR');
        setIsLoading(false);
        return;
      }

      if (!sitesData || sitesData.length === 0) {
        setSites([]);
        setTenancyStatus('ONBOARDING_REQUIRED');
      } else {
        setSites(sitesData as Site[]);
        setCurrentSiteId((prev) => (prev && sitesData.some((s) => s.id === prev) ? prev : sitesData[0].id));
        setTenancyStatus('READY');
      }
    } catch (err) {
      setCurrentOrg(null);
      setSites([]);
      setEntitlements([]);
      setErrorMessage(err instanceof Error ? err.message : 'Unknown tenancy resolution error');
      setTenancyStatus('ERROR');
    } finally {
      setIsLoading(false);
    }
  }, [supabase, isDemo]);

  useEffect(() => {
    loadUserData();
  }, [loadUserData]);

  const currentSite = sites.find((s) => s.id === currentSiteId) || sites[0] || null;

  const switchSite = (siteId: string) => {
    setCurrentSiteId(siteId);
  };

  const switchRole = (role: PlatformRole) => {
    setActiveRole(role);
  };

  const isEntitled = (productId: string): boolean => {
    if (isDemo) return true;
    const normalized =
      productId === 'OPEN_ACCESS_COMPLIANCE' ? 'OA_COMPLIANCE' :
      productId === 'DSM_MONITOR' || productId === 'DSM_RISK_MONITOR' ? 'DSM_RISK' :
      productId;
    return entitlements.includes(normalized) || entitlements.includes(productId);
  };

  return (
    <SiteContext.Provider
      value={{
        currentOrg,
        currentSite,
        activeRole,
        sites,
        entitlements,
        isEntitled,
        isLoading,
        tenancyStatus,
        errorMessage,
        switchSite,
        switchRole,
        refreshSites: loadUserData,
      }}
    >
      {children}
    </SiteContext.Provider>
  );
}

export function useSite() {
  const context = useContext(SiteContext);
  if (!context) {
    throw new Error('useSite must be used within a SiteProvider');
  }
  return context;
}
