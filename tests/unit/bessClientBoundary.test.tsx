import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/layout/SiteContext', () => ({
  useSite: () => ({
    currentSite: { id: 'site-1', is_demo: false },
    isEntitled: () => true,
  }),
}));
vi.mock('@/components/shared/ModuleGate', () => ({
  ModuleGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'browser-session-token' } } }) } }),
}));

describe('BESS client/server boundary', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('renders the client page in production without evaluating ANALYTICS_SERVICE_TOKEN', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ANALYTICS_SERVICE_TOKEN', '');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ simulation: { status: 'SUPPRESSED', suppression_reason: 'BESS_PROFILE_REQUIRED' } }),
    }));
    vi.resetModules();
    const { default: BESSPage } = await import('@/app/bess/page');
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<BESSPage />));
    expect(container.textContent).toContain('BESS Arbitrage Signals');
    expect(container.textContent).toContain('BEHIND-THE-METER BESS ENERGY-SHIFT SIMULATION');
    expect(fetch).toHaveBeenCalledWith('/api/bess/simulation?site_id=site-1', expect.objectContaining({
      headers: { Authorization: 'Bearer browser-session-token' },
    }));
    await act(async () => root.unmount());
    container.remove();
  });
});
