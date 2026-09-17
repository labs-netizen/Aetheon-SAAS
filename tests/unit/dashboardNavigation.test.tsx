import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from '@/app/page';

const context = vi.hoisted(() => ({
  org: { id: 'org-1', name: 'Aetheon Test Organisation' },
  site: {
    id: 'site-1', name: 'Aetheon Test Facility', state: 'Maharashtra', discom: 'MSEDCL',
    contract_demand_value: 1500, contract_demand_unit: 'kVA', activation_status: 'ACTIVE', is_demo: false,
  },
  entitlements: new Set(['GRID_INTELLIGENCE']),
}));

vi.mock('@/components/layout/SiteContext', () => ({
  useSite: () => ({
    currentOrg: context.org,
    currentSite: context.site,
    isEntitled: (productId: string) => context.entitlements.has(productId),
  }),
}));

describe('dashboard product navigation', () => {
  beforeEach(() => {
    context.site = { ...context.site, id: 'site-1', name: 'Aetheon Test Facility', is_demo: false, activation_status: 'ACTIVE' };
    context.org = { id: 'org-1', name: 'Aetheon Test Organisation' };
    context.entitlements = new Set(['GRID_INTELLIGENCE']);
  });

  async function renderDashboard() {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<DashboardPage />));
    return { container, root };
  }

  it('links the BESS Arbitrage Signals launch action directly to /bess', async () => {
    const { container, root } = await renderDashboard();
    const launch = container.querySelector('[data-testid="launch-bess-module"]');
    expect(launch?.tagName).toBe('A');
    expect(launch?.getAttribute('href')).toBe('/bess');
    expect(launch?.querySelector('button')).toBeNull();
    await act(async () => root.unmount());
    container.remove();
  });

  it('shows no fabricated operational values or recommendations for an active live site without evidence', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { container, root } = await renderDashboard();
    const text = container.textContent || '';

    expect(container.querySelector('[data-testid="dashboard-demand-kpi"]')?.textContent).toContain('UNAVAILABLE');
    expect(container.querySelector('[data-testid="dashboard-price-kpi"]')?.textContent).toContain('UNAVAILABLE');
    expect(container.querySelector('[data-testid="dashboard-solar-kpi"]')?.textContent).toContain('UNAVAILABLE');
    expect(container.querySelector('[data-testid="dashboard-cost-kpi"]')?.textContent).toContain('UNAVAILABLE');
    expect(container.querySelector('[data-testid="dashboard-grid-brief"]')?.textContent).toContain('SUPPRESSED');
    expect(container.querySelector('[data-testid="dashboard-live-evidence-state"]')?.textContent).toContain('NOT VERIFIED');
    expect(text).not.toContain('2,180.50');
    expect(text).not.toContain('₹4,820/MWh');
    expect(text).not.toContain('88.4%');
    expect(text).not.toContain('₹48,250');
    expect(text).not.toContain('Recommended load curtailment');
    expect(text).not.toContain('Recommended window');
    expect(container.querySelector('[data-testid="dashboard-demo-provenance"]')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    container.remove();
    fetchSpy.mockRestore();
  });

  it('keeps synthetic metrics only on demo sites and labels them as demo and unverified', async () => {
    context.site = { ...context.site, id: 'demo-site', name: 'Demo Facility', is_demo: true };
    context.entitlements = new Set(['GRID_INTELLIGENCE', 'OA_COMPLIANCE', 'DSM_RISK', 'BESS_ARBITRAGE', 'RENEWABLE_PORTFOLIO']);
    const { container, root } = await renderDashboard();
    const text = container.textContent || '';

    expect(container.querySelector('[data-testid="dashboard-demo-label"]')?.textContent).toContain('DEMO / UNVERIFIED');
    expect(container.querySelector('[data-testid="dashboard-demand-kpi"]')?.textContent).not.toContain('UNAVAILABLE');
    expect(container.querySelector('[data-testid="dashboard-price-kpi"]')?.textContent).toContain('₹4,820/MWh');
    expect(container.querySelector('[data-testid="dashboard-solar-kpi"]')?.textContent).toContain('88.4%');
    expect(text).toContain('Synthetic demo');
    expect(container.querySelector('[data-testid="dashboard-demo-provenance"]')?.textContent).toContain('Synthetic demo dataset');
    expect(container.querySelector('[data-testid="dashboard-live-provenance"]')).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it('renders only the selected tenant/site identity and entitlement state', async () => {
    context.org = { id: 'org-own', name: 'Own Organisation' };
    context.site = { ...context.site, id: 'site-own', name: 'Own Site', is_demo: false };
    context.entitlements = new Set(['GRID_INTELLIGENCE']);
    const { container, root } = await renderDashboard();
    const text = container.textContent || '';

    expect(text).toContain('Own Organisation');
    expect(text).toContain('Own Site');
    expect(text).not.toContain('Foreign Organisation');
    expect(text).toContain('ENTITLED');
    expect(text).toContain('UNSUBSCRIBED');

    await act(async () => root.unmount());
    container.remove();
  });
});
