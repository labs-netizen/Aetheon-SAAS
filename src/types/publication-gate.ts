/**
 * Canonical Publication Gate Model & Helpers
 * Single source of truth for publication gate status and completeness threshold.
 */
import type { PublicationGateStatus } from './index';

export type { PublicationGateStatus };

export const PUBLISHABLE_STATES: PublicationGateStatus[] = [
  'PUBLISHABLE',
  'PUBLISHABLE_WITH_WARNING',
];

export const isPublishable = (status: string | null | undefined): boolean => {
  if (!status) return false;
  return PUBLISHABLE_STATES.includes(status as PublicationGateStatus);
};

export const COMPLETENESS_THRESHOLD = 95.0; // Single canonical completeness threshold
