'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import type { Organisation, Site, PlatformRole } from '@/types';
import { createClient } from '@/lib/supabase/client';

export interface SiteContextValue {
  currentOrg: Organisation;
  currentSite: Site;
  activeRole: PlatformRole;
  sites: Site[];
  isLoading: boolean;
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

const SiteContext = createContext<SiteContextValue | undefined>(undefined);

export function SiteProvider({ children }: { children: React.ReactNode }) {
  const [currentOrg, setCurrentOrg] = useState<Organisation>(DEMO_ORG);
  const [sites, setSites] = useState<Site[]>(DEMO_SITES);
  const [currentSiteId, setCurrentSiteId] = useState<string>(DEMO_SITES[0].id);
  const [activeRole, setActiveRole] = useState<PlatformRole>('ORGANISATION_ADMIN');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const supabase = createClient();

  const loadUserData = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const isDemo = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
      if (isDemo) {
        setIsLoading(false);
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setIsLoading(false);
        return;
      }

      // Query user memberships and organization
      const { data: membershipData } = await supabase
        .from('memberships')
        .select(`
          role,
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
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (membershipData && membershipData.organisations) {
        const org = Array.isArray(membershipData.organisations)
          ? membershipData.organisations[0]
          : membershipData.organisations;

        setCurrentOrg(org as unknown as Organisation);
        if (membershipData.role) {
          setActiveRole(membershipData.role as PlatformRole);
        }

        // Query sites for this organisation
        const { data: sitesData } = await supabase
          .from('sites')
          .select('*')
          .eq('organisation_id', org.id);

        if (sitesData && sitesData.length > 0) {
          setSites(sitesData as Site[]);
          setCurrentSiteId(sitesData[0].id);
        }
      }
    } catch (err) {
      console.warn('Error fetching live tenancy context, keeping fallback:', err);
    } finally {
      setIsLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    loadUserData();
  }, [loadUserData]);

  const currentSite = sites.find((s) => s.id === currentSiteId) || sites[0] || DEMO_SITES[0];

  const switchSite = (siteId: string) => {
    setCurrentSiteId(siteId);
  };

  const switchRole = (role: PlatformRole) => {
    setActiveRole(role);
  };

  return (
    <SiteContext.Provider
      value={{
        currentOrg,
        currentSite,
        activeRole,
        sites,
        isLoading,
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
