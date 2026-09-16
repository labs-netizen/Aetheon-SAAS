import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

describe('server analytics credential boundary', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('still fails closed when the production server token is absent', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ANALYTICS_SERVICE_TOKEN', '');
    vi.resetModules();
    await expect(import('@/lib/analytics/client')).rejects.toThrow(
      'CRITICAL: ANALYTICS_SERVICE_TOKEN must be set in production environment'
    );
  });
});
