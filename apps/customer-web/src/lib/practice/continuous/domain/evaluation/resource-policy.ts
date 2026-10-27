import { ContinuousEvaluationError } from './evaluation-error';

/** Browser evaluation safety budgets; never learner/timing policy or result provenance. */
export const CONTINUOUS_EVALUATION_RESOURCES = Object.freeze({
  maxObservationsPerPublication: 16_384,
  maxRetainedObservations: 65_536,
  maxRetainedPublications: 65_536,
  maxPendingMidiObservations: 4_096,
  maxMatchingEdges: 262_144,
  maxIdentityChars: 512,
  maxPitchChars: 16,
});

export function assertContinuousResourceCount(count: number, limit: number): void {
  if (count > limit) throw new ContinuousEvaluationError('CONTINUOUS_EVALUATION_RESOURCE_LIMIT_EXCEEDED');
}
export function assertContinuousIdentityBudget(identity: string, pitch = false): void {
  assertContinuousResourceCount(identity.length, pitch ? CONTINUOUS_EVALUATION_RESOURCES.maxPitchChars : CONTINUOUS_EVALUATION_RESOURCES.maxIdentityChars);
}
