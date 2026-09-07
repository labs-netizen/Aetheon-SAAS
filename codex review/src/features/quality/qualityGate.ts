/**
 * Central Data Quality & Publication Quality Gate
 * Evaluates whether operational calculations are safe to publish to customer portal.
 * MANDATORY REQUIREMENT: If critical input data is stale or missing, recommendations must be HARD-SUPPRESSED.
 */

import type {
  FreshnessStatus,
  ValidationStatus,
  PublicationGateStatus
} from '@/types';

export interface QualityMetadata {
  sourceTimestamp: string;
  sourceType: string;
  completenessPct: number;
  totalBlocksExpected: number;
  totalBlocksReceived: number;
  validationStatus: ValidationStatus;
  freshnessStatus: FreshnessStatus;
  modelVersion: string;
  modelGenerationTime: string;
  tariffVersion?: string;
  ruleVersion?: string;
}

export interface QualityGateEvaluation {
  gateStatus: PublicationGateStatus;
  isPublishable: boolean;
  isSuppressed: boolean;
  suppressionReason?: string;
  remediationAdvice?: string;
  qualityMetadata: QualityMetadata;
}

/**
 * Evaluate operational output against publication quality rules.
 */
export function evaluateQualityGate(meta: QualityMetadata): QualityGateEvaluation {
  // 1. Critical Rule: Stale Data Hard-Suppression
  if (meta.freshnessStatus === 'STALE') {
    return {
      gateStatus: 'BLOCKED_STALE_DATA',
      isPublishable: false,
      isSuppressed: true,
      suppressionReason: 'Critical input telemetry is stale (> 24 hours). Actionable recommendations are suppressed.',
      remediationAdvice: 'Upload today\'s 15-minute AMR interval meter readings or verify EMS data-gateway connection.',
      qualityMetadata: meta,
    };
  }

  // 2. Critical Rule: Missing Input Blocks (< 90% completeness)
  if (meta.completenessPct < 90.0) {
    return {
      gateStatus: 'BLOCKED_MISSING_INPUT',
      isPublishable: false,
      isSuppressed: true,
      suppressionReason: `Data completeness is ${meta.completenessPct.toFixed(1)}% (minimum 90.0% required).`,
      remediationAdvice: `Upload complete 96-block interval dataset. Current file has ${meta.totalBlocksReceived}/96 blocks.`,
      qualityMetadata: meta,
    };
  }

  // 3. Validation Failure
  if (meta.validationStatus === 'FAILED') {
    return {
      gateStatus: 'BLOCKED_INVALID_CONFIGURATION',
      isPublishable: false,
      isSuppressed: true,
      suppressionReason: 'Data failed validation integrity checks (negative values or invalid block sequence).',
      remediationAdvice: 'Review ingestion run error logs and re-upload compliant interval file.',
      qualityMetadata: meta,
    };
  }

  // 4. Warning condition (between 90% and 99% completeness)
  if (meta.completenessPct < 100.0) {
    return {
      gateStatus: 'PUBLISHABLE_WITH_WARNING',
      isPublishable: true,
      isSuppressed: false,
      suppressionReason: `Mild data gaps detected: ${meta.totalBlocksReceived}/96 blocks present.`,
      qualityMetadata: meta,
    };
  }

  // 5. Clean / Passed
  return {
    gateStatus: 'PUBLISHABLE',
    isPublishable: true,
    isSuppressed: false,
    qualityMetadata: meta,
  };
}
