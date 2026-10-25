import type { ContinuousAssignmentSnapshot } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
import type { CompletedContinuousAssignment, CompletedContinuousAssignmentResult, FinalizedContinuousGroupAssignment } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
import { immutableContinuousValue } from '@/lib/practice/continuous/domain/evaluation/immutable-value';

/** Completion projects the accumulated ledger without running assignment again. */
export function completeContinuousAssignment(snapshot: ContinuousAssignmentSnapshot): CompletedContinuousAssignmentResult {
  const finalized = (group: ContinuousAssignmentSnapshot['groups'][number]): group is FinalizedContinuousGroupAssignment =>
    group.state === 'FINALIZED' && group.finality !== null && group.strikes.every(strike => ['MATCHED', 'UNMATCHED', 'NOT_REACHED'].includes(strike.state));
  if (!snapshot.completion || !snapshot.groups.every(finalized) || snapshot.reservedObservationIds.length
    || snapshot.observationAssignments.length !== snapshot.observations.length) {
    return Object.freeze({ status: 'UNAVAILABLE', reason: 'INCOMPLETE_ANALYSIS' });
  }
  return immutableContinuousValue({ status: 'COMPLETE', assignment: {
    sessionDomainId: snapshot.sessionDomainId, observations: snapshot.observations, groups: snapshot.groups,
    unattributedObservations: snapshot.unattributedObservations, observationAssignments: snapshot.observationAssignments,
    completion: snapshot.completion,
  } });
}

/** Validate retained assignment data at the completed-artifact boundary. */
export function assertCompletedAssignment(assignment: CompletedContinuousAssignment): void {
  if (!Array.isArray(assignment.groups) || !Array.isArray(assignment.observations)
    || !Array.isArray(assignment.unattributedObservations) || !Array.isArray(assignment.observationAssignments)
    || !assignment.completion) throw new Error('CompletedPerformance assignment is corrupt.');
  const declarations: CompletedContinuousAssignment['observationAssignments'][number][] = [];
  for (const group of assignment.groups) {
    if (group.state !== 'FINALIZED' || !group.finality || !Array.isArray(group.residualObservations)) {
      throw new Error('CompletedPerformance group must be final.');
    }
    for (const strike of group.strikes) {
      if (!Array.isArray(strike.renderNoteIds)) throw new Error('CompletedPerformance strike renderNoteIds are required.');
      if (!['MATCHED', 'UNMATCHED', 'NOT_REACHED'].includes(strike.state) || !strike.finality) {
        throw new Error('CompletedPerformance strike must be final.');
      }
      if (strike.state === 'MATCHED') {
        if (!strike.match?.observation.observationId || !Number.isFinite(strike.match.observation.confidence)
          || !Number.isFinite(strike.match.timingOffsetMs)) throw new Error('CompletedPerformance matched strike metadata is required.');
        declarations.push({ kind: 'STRIKE_MATCH', observationId: strike.match.observation.observationId, strikeId: strike.strikeId });
      }
    }
    declarations.push(...group.residualObservations.map((observation: import('./evidence-types').ContinuousObservation) => ({ kind: 'GROUP_RESIDUAL' as const, observationId: observation.observationId, groupId: group.groupId })));
  }
  declarations.push(...assignment.unattributedObservations.map(row => ({ kind: 'UNATTRIBUTED' as const, observationId: row.observation.observationId })));
  const relations = assignment.observationAssignments;
  if (new Set(declarations.map(row => row.observationId)).size !== declarations.length
    || new Set(assignment.observations.map(row => row.observationId)).size !== assignment.observations.length
    || relations.length !== declarations.length || relations.length !== assignment.observations.length
    || declarations.some(row => !relations.some(other => JSON.stringify(other) === JSON.stringify(row)))
    || assignment.observations.some(observation => !relations.some(row => row.observationId === observation.observationId))) {
    throw new Error('CompletedPerformance observation assignment is corrupt.');
  }
}
