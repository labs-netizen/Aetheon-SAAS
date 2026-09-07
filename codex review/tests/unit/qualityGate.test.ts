import { describe, it, expect } from 'vitest';
import { evaluateQualityGate, type QualityMetadata } from '@/features/quality/qualityGate';

describe('Central Publication Quality Gate', () => {
  const baseMeta: QualityMetadata = {
    sourceTimestamp: '2026-09-08T06:00:00Z',
    sourceType: 'AMR Smart Meter',
    completenessPct: 100.0,
    totalBlocksExpected: 96,
    totalBlocksReceived: 96,
    validationStatus: 'PASSED',
    freshnessStatus: 'RECENT',
    modelVersion: 'GRID_INTEL_v1.0',
    modelGenerationTime: '2026-09-08T06:15:00Z',
  };

  it('should publish cleanly when data is complete and fresh', () => {
    const outcome = evaluateQualityGate(baseMeta);
    expect(outcome.gateStatus).toBe('PUBLISHABLE');
    expect(outcome.isPublishable).toBe(true);
    expect(outcome.isSuppressed).toBe(false);
  });

  it('should hard-suppress recommendations when data is STALE (>24 hours)', () => {
    const staleMeta: QualityMetadata = {
      ...baseMeta,
      freshnessStatus: 'STALE',
    };
    const outcome = evaluateQualityGate(staleMeta);
    expect(outcome.gateStatus).toBe('BLOCKED_STALE_DATA');
    expect(outcome.isPublishable).toBe(false);
    expect(outcome.isSuppressed).toBe(true);
    expect(outcome.suppressionReason).toContain('stale');
    expect(outcome.remediationAdvice).toBeDefined();
  });

  it('should hard-suppress recommendations when blocks are missing (<90% completeness)', () => {
    const missingMeta: QualityMetadata = {
      ...baseMeta,
      completenessPct: 75.0,
      totalBlocksReceived: 72,
    };
    const outcome = evaluateQualityGate(missingMeta);
    expect(outcome.gateStatus).toBe('BLOCKED_MISSING_INPUT');
    expect(outcome.isPublishable).toBe(false);
    expect(outcome.isSuppressed).toBe(true);
    expect(outcome.suppressionReason).toContain('75.0%');
  });

  it('should allow publication with warning if completeness is between 90% and 99%', () => {
    const warningMeta: QualityMetadata = {
      ...baseMeta,
      completenessPct: 95.0,
      totalBlocksReceived: 91,
    };
    const outcome = evaluateQualityGate(warningMeta);
    expect(outcome.gateStatus).toBe('PUBLISHABLE_WITH_WARNING');
    expect(outcome.isPublishable).toBe(true);
    expect(outcome.isSuppressed).toBe(false);
  });
});
