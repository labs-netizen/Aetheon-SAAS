import { describe, expect, it } from 'vitest';
import { resolveCurrentSite } from '@/components/layout/SiteContext';
import type { Site } from '@/types';

const realSite = { id: 'real-site', organisation_id: 'real-org', name: 'Real Facility' } as Site;

describe('site selection identity', () => {
  it('does not allow a stale demo site ID to override the resolved live site', () => {
    expect(resolveCurrentSite([realSite], 'b0000000-0000-0000-0000-000000000001')?.id).toBe('real-site');
  });

  it('returns the exact selected site when it exists in the current tenant site list', () => {
    const secondSite = { ...realSite, id: 'selected-real-site' };
    expect(resolveCurrentSite([realSite, secondSite], secondSite.id)).toBe(secondSite);
  });
});
