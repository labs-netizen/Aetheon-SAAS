import { describe, expect, it } from 'vitest';
import { resolveSiteForAuthorization } from '@/lib/auth/api-guard';

const clientReturning = (result: { data: unknown; error: { message: string } | null }) => ({
  from: () => ({
    select: () => ({
      eq: () => ({ maybeSingle: async () => result }),
    }),
  }),
});

describe('site authorization lookup result integrity', () => {
  it('does not mislabel an authenticated permission error as site not found', async () => {
    const result = await resolveSiteForAuthorization(
      clientReturning({ data: null, error: { message: 'permission denied for table sites' } }) as any,
      clientReturning({ data: null, error: null }) as any,
      'own-site'
    );
    expect(result).toEqual({
      status: 'LOOKUP_FAILED',
      source: 'authenticated',
      message: 'permission denied for table sites',
    });
  });

  it('resolves an own site from the bearer-authenticated client without service fallback', async () => {
    const site = { id: 'own-site', organisation_id: 'own-org', name: 'Own', state: 'Maharashtra', discom: 'MSEDCL', is_demo: false };
    const result = await resolveSiteForAuthorization(
      clientReturning({ data: site, error: null }) as any,
      clientReturning({ data: null, error: { message: 'must not be reached' } }) as any,
      site.id
    );
    expect(result).toEqual({ status: 'FOUND', site, source: 'authenticated' });
  });
});
