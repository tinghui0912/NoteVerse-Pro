import { ContinuousEvaluationError } from '@/lib/practice/continuous/domain/evaluation/evaluation-error';
import { type ContinuousExpectedStrike } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
import { type ContinuousObservation } from '@/lib/practice/continuous/domain/evaluation/evidence-types';

export const CONTINUOUS_ASSIGNMENT_POLICY_ID = 'CONTINUOUS_EXACT_PITCH_ASSIGNMENT_FINALITY_V2';

export const CONTINUOUS_ASSIGNMENT_WINDOW_MS = 250;
export const CONTINUOUS_ANALYSIS_BOUNDS_MS = Object.freeze({ strike: 750, group: 1250, residual: 1500 });
export const withinContinuousWindow = (a: number, b: number): boolean => Math.abs(a - b) <= CONTINUOUS_ASSIGNMENT_WINDOW_MS;

/** Literal interval overlap only: never query a member's cohort or follow graph edges. */
export function directStrikeCohort(anchor: ContinuousExpectedStrike, strikes: readonly ContinuousExpectedStrike[]): readonly ContinuousExpectedStrike[] {
  return strikes.filter(strike => strike.pitch === anchor.pitch
    && Math.abs(strike.expectedPerformanceTimeMs - anchor.expectedPerformanceTimeMs) <= 2 * CONTINUOUS_ASSIGNMENT_WINDOW_MS);
}

export function directStrikeFrontier(anchor: ContinuousExpectedStrike, strikes: readonly ContinuousExpectedStrike[]): number {
  const required = Math.max(...directStrikeCohort(anchor, strikes).map(strike => strike.expectedPerformanceTimeMs + CONTINUOUS_ASSIGNMENT_WINDOW_MS));
  assertContinuousBound(required, anchor.expectedPerformanceTimeMs, CONTINUOUS_ANALYSIS_BOUNDS_MS.strike);
  return required;
}

export function directObservationClaimants(observation: ContinuousObservation, strikes: readonly ContinuousExpectedStrike[]): readonly ContinuousExpectedStrike[] {
  return strikes.filter(strike => strike.pitch === observation.pitch
    && withinContinuousWindow(strike.expectedPerformanceTimeMs, observation.performanceTimeMs));
}

export function assertContinuousBound(frontier: number, target: number, bound: number): void {
  if (frontier > target + bound + 1e-8) throw new ContinuousEvaluationError('FINALIZATION_BOUND_EXCEEDED');
}
