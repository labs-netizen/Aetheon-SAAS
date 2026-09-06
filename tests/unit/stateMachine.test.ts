import { describe, it, expect } from 'vitest';
import { evaluateActivationState } from '@/features/onboarding/stateMachine';

describe('Operational Activation State Machine', () => {
  it('should remain CONFIGURED if parameters are missing', () => {
    const outcome = evaluateActivationState({
      hasValidConfig: false,
      hasIntervalData: false,
      isCalibrated: false,
      isDataFresh: false,
      daysOfData: 0,
    });
    expect(outcome.targetStatus).toBe('CONFIGURED');
    expect(outcome.isActionRequired).toBe(true);
  });

  it('should transition to AWAITING_DATA when site config is valid but no intervals uploaded', () => {
    const outcome = evaluateActivationState({
      hasValidConfig: true,
      hasIntervalData: false,
      isCalibrated: false,
      isDataFresh: false,
      daysOfData: 0,
    });
    expect(outcome.targetStatus).toBe('AWAITING_DATA');
    expect(outcome.isActionRequired).toBe(true);
  });

  it('should transition to CALIBRATING when initial data is received (<7 days)', () => {
    const outcome = evaluateActivationState({
      hasValidConfig: true,
      hasIntervalData: true,
      isCalibrated: false,
      isDataFresh: true,
      daysOfData: 3,
    });
    expect(outcome.targetStatus).toBe('CALIBRATING');
    expect(outcome.isActionRequired).toBe(false);
  });

  it('should transition to ACTIVE when data is calibrated and fresh', () => {
    const outcome = evaluateActivationState({
      hasValidConfig: true,
      hasIntervalData: true,
      isCalibrated: true,
      isDataFresh: true,
      daysOfData: 30,
    });
    expect(outcome.targetStatus).toBe('ACTIVE');
    expect(outcome.isActionRequired).toBe(false);
  });

  it('should degrade to DEGRADED if active monitoring loses data freshness', () => {
    const outcome = evaluateActivationState({
      hasValidConfig: true,
      hasIntervalData: true,
      isCalibrated: true,
      isDataFresh: false, // stale telemetry
      daysOfData: 30,
    });
    expect(outcome.targetStatus).toBe('DEGRADED');
    expect(outcome.isActionRequired).toBe(true);
  });
});
