import { type ContinuousExpectedStrike } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
import { type ContinuousObservation } from '@/lib/practice/continuous/domain/evaluation/evidence-types';

export const CONTINUOUS_ASSIGNMENT_POLICY_ID = 'CONTINUOUS_EXACT_PITCH_ASSIGNMENT_FINALITY_V3';

export const CONTINUOUS_ASSIGNMENT_WINDOW_MS = 250;
export const withinContinuousWindow = (a: number, b: number): boolean => Math.abs(a - b) <= CONTINUOUS_ASSIGNMENT_WINDOW_MS;

/** Literal interval overlap only: never query a member's cohort or follow graph edges. */
export function directStrikeCohort(anchor: ContinuousExpectedStrike, strikes: readonly ContinuousExpectedStrike[]): readonly ContinuousExpectedStrike[] {
  return strikes.filter(strike => strike.pitch === anchor.pitch
    && Math.abs(strike.expectedPerformanceTimeMs - anchor.expectedPerformanceTimeMs) <= 2 * CONTINUOUS_ASSIGNMENT_WINDOW_MS);
}

export function directStrikeFrontier(anchor: ContinuousExpectedStrike, strikes: readonly ContinuousExpectedStrike[]): number {
  // Direct members lie within 2W, so their latest window end is at most anchor + 3W.
  const required = Math.max(...directStrikeCohort(anchor, strikes).map(strike => strike.expectedPerformanceTimeMs + CONTINUOUS_ASSIGNMENT_WINDOW_MS));
  return required;
}

export function directObservationClaimants(observation: ContinuousObservation, strikes: readonly ContinuousExpectedStrike[]): readonly ContinuousExpectedStrike[] {
  return strikes.filter(strike => strike.pitch === observation.pitch
    && withinContinuousWindow(strike.expectedPerformanceTimeMs, observation.performanceTimeMs));
}
