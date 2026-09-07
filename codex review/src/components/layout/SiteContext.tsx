'use client';

import React, { createContext, useContext, useState } from 'react';
import type { Organisation, Site, PlatformRole } from '@/types';

export interface SiteContextValue {
  currentOrg: Organisation;
  currentSite: Site;
  activeRole: PlatformRole;
  sites: Site[];
  switchSite: (siteId: string) => void;
  switchRole: (role: PlatformRole) => void;
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
    name: 'Chakan Auto Components Plant 1',
    state: 'Maharashtra',
    discom: 'MSEDCL',
    voltage_category: '33kV',
    contract_demand_value: 2500,
    contract_demand_unit: 'kVA',
    metering_point: 'Main Substation Incomer Feeder 1',
    load_class: 'Automotive Continuous Process',
    timezone: 'Asia/Kolkata',
    activation_status: 'ACTIVE',
    activation_reason: 'Calibrated on 30-day historical interval dataset (DEMO)',
    last_status_change: '2026-09-01T00:00:00Z',
    is_demo: true,
  },
  {
    id: 'b0000000-0000-0000-0000-000000000002',
    organisation_id: 'a0000000-0000-0000-0000-000000000001',
    name: 'Sanand Engineering Unit 2',
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
  const [currentOrg] = useState<Organisation>(DEMO_ORG);
  const [sites] = useState<Site[]>(DEMO_SITES);
  const [currentSiteId, setCurrentSiteId] = useState<string>(DEMO_SITES[0].id);
  const [activeRole, setActiveRole] = useState<PlatformRole>('ORGANISATION_ADMIN');

  const currentSite = sites.find((s) => s.id === currentSiteId) || sites[0];

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
        switchSite,
        switchRole,
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
