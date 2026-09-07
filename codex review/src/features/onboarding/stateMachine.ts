/**
 * Operational Activation State Machine
 * States: CONFIGURED -> AWAITING_DATA -> CALIBRATING -> ACTIVE / DEGRADED
 * Explicitly decoupled from commercial payment and subscription status.
 */

import type { OperationalActivationStatus } from '@/types';

export interface ActivationContext {
  hasValidConfig: boolean;
  hasIntervalData: boolean;
  isCalibrated: boolean;
  isDataFresh: boolean;
  daysOfData: number;
}

export interface ActivationTransition {
  currentStatus: OperationalActivationStatus;
  targetStatus: OperationalActivationStatus;
  reason: string;
  isActionRequired: boolean;
  actionMessage?: string;
}

export function evaluateActivationState(ctx: ActivationContext): ActivationTransition {
  // 1. Initial configuration only
  if (!ctx.hasValidConfig) {
    return {
      currentStatus: 'CONFIGURED',
      targetStatus: 'CONFIGURED',
      reason: 'Site electrical parameters (State, DISCOM, Contract Demand, Voltage) incomplete.',
      isActionRequired: true,
      actionMessage: 'Complete site operational configuration form.',
    };
  }

  // 2. Awaiting Data
  if (!ctx.hasIntervalData || ctx.daysOfData === 0) {
    return {
      currentStatus: 'CONFIGURED',
      targetStatus: 'AWAITING_DATA',
      reason: 'No interval meter data received yet for this site.',
      isActionRequired: true,
      actionMessage: 'Upload historical 15-minute AMR load data (minimum 30 days recommended).',
    };
  }

  // 3. Calibrating
  if (!ctx.isCalibrated || ctx.daysOfData < 7) {
    return {
      currentStatus: 'AWAITING_DATA',
      targetStatus: 'CALIBRATING',
      reason: `Received ${ctx.daysOfData} days of data. Model calibration in progress (7 days minimum required).`,
      isActionRequired: false,
      actionMessage: 'Awaiting calibration cycle completion.',
    };
  }

  // 4. Degraded state (telemetry stale)
  if (!ctx.isDataFresh) {
    return {
      currentStatus: 'ACTIVE',
      targetStatus: 'DEGRADED',
      reason: 'Operational data pipeline stale. Last data received more than 24 hours ago.',
      isActionRequired: true,
      actionMessage: 'Restore data gateway connection or upload latest daily interval file.',
    };
  }

  // 5. Active operational monitoring
  return {
    currentStatus: 'CALIBRATING',
    targetStatus: 'ACTIVE',
    reason: 'Operational calibration complete. All data readiness requirements satisfied.',
    isActionRequired: false,
  };
}
