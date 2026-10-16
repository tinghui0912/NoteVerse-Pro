import {
  immutableContinuousValue, type CompletedContinuousEvaluation, type ContinuousEvaluationSnapshot,
  type ContinuousGroupEvaluation, type ContinuousFinalizedGroup,
} from './continuous-evaluation-types';

/** Completion projects the accumulated truth; it never performs a second assignment pass. */
export function completedContinuousTruth(snapshot: ContinuousEvaluationSnapshot): CompletedContinuousEvaluation {
  const finalized = (group: ContinuousGroupEvaluation): group is ContinuousFinalizedGroup =>
    group.verdict !== 'PENDING' && group.finality !== null && group.strikes.every(strike => strike.state !== 'PENDING');
  if (!snapshot.completion || !snapshot.groups.every(finalized)
    || snapshot.reservedObservationIds.length) return Object.freeze({ status: 'UNAVAILABLE', reason: 'INCOMPLETE_ANALYSIS' });
  return immutableContinuousValue({
    status: 'COMPLETE', sessionDomainId: snapshot.sessionDomainId,
    groups: snapshot.groups, extras: snapshot.extras, observationOwnership: snapshot.observationOwnership,
    completion: snapshot.completion,
  });
}
