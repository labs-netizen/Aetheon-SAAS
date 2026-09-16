import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import DashboardPage from '@/app/page';

vi.mock('@/components/layout/SiteContext', () => ({
  useSite: () => ({
    currentOrg: { id: 'org-1', name: 'Aetheon Test Organisation' },
    currentSite: {
      id: 'site-1', name: 'Aetheon Test Facility', state: 'Maharashtra', discom: 'MSEDCL',
      contract_demand_value: 1500, contract_demand_unit: 'kVA', activation_status: 'ACTIVE',
    },
  }),
}));

describe('dashboard product navigation', () => {
  it('links the BESS Arbitrage Signals launch action directly to /bess', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<DashboardPage />));
    const launch = container.querySelector('[data-testid="launch-bess-module"]');
    expect(launch?.tagName).toBe('A');
    expect(launch?.getAttribute('href')).toBe('/bess');
    expect(launch?.querySelector('button')).toBeNull();
    await act(async () => root.unmount());
    container.remove();
  });
});
