import type { ContinuousAssignmentSnapshot } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
import type { CompletedContinuousAssignment, CompletedContinuousAssignmentResult, FinalizedContinuousGroupAssignment, FinalizedContinuousStrikeAssignment, ContinuousGroupResidualAssignment } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
import type { ContinuousObservation } from '@/lib/practice/continuous/domain/evaluation/evidence-types';
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
    || !assignment.completion) throw new Error('Continuous assignment assignment is corrupt.');
  const completion = assignment.completion;
  if (Object.keys(completion).sort().join() !== ['reason', 'performanceTimeMs', 'availabilitySessionTimeMs'].sort().join()
    || !['SCOPE_COMPLETED', 'STOPPED_BY_USER'].includes(completion.reason)
    || !Number.isFinite(completion.performanceTimeMs) || completion.performanceTimeMs < 0
    || !Number.isFinite(completion.availabilitySessionTimeMs) || completion.availabilitySessionTimeMs < 0) {
    throw new Error('Continuous assignment completion coordinates are corrupt.');
  }
  const ledger = new Map(assignment.observations.map(row => [row.observationId, row]));
  if (ledger.size !== assignment.observations.length) throw new Error('Continuous assignment observation assignment is corrupt.');
  const declarations = new Map<string, CompletedContinuousAssignment['observationAssignments'][number]>();
  const groups = new Set<string>(), strikes = new Set<string>(), residualSlots = new Set<string>();
  const claim = (relation: CompletedContinuousAssignment['observationAssignments'][number], observation: ContinuousObservation) => {
    const retained = ledger.get(observation.observationId);
    if (!retained || !sameObservation(retained, observation) || declarations.has(observation.observationId)) {
      throw new Error('Continuous assignment observation assignment is corrupt.');
    }
    declarations.set(observation.observationId, relation);
  };
  for (const group of assignment.groups) {
    if (group.state !== 'FINALIZED' || !group.finality || !Array.isArray(group.strikes)
      || !Array.isArray(group.residualAssignments) || !group.groupId || groups.has(group.groupId)) {
      throw new Error('Continuous assignment group must be final and unique.');
    }
    groups.add(group.groupId);
    assertFinality(group.finality, completion);
    const groupStrikes: readonly FinalizedContinuousStrikeAssignment[] = group.strikes;
    const residuals: readonly ContinuousGroupResidualAssignment[] = group.residualAssignments;
    for (const strike of groupStrikes) {
      if (!Array.isArray(strike.renderNoteIds)) throw new Error('Continuous assignment strike renderNoteIds are required.');
      if (!['MATCHED', 'UNMATCHED', 'NOT_REACHED'].includes(strike.state) || !strike.finality) {
        throw new Error('Continuous assignment strike must be final.');
      }
      if (!strike.strikeId || strikes.has(strike.strikeId) || strike.groupId !== group.groupId) {
        throw new Error('Continuous assignment strike identity is corrupt.');
      }
      strikes.add(strike.strikeId);
      assertFinality(strike.finality, completion);
      if (group.finality.finalizationSessionTimeMs < strike.finality.finalizationSessionTimeMs
        || group.finality.enablingAnalysisFrontierMs < strike.finality.enablingAnalysisFrontierMs) {
        throw new Error('Continuous assignment group precedes child strike finality.');
      }
      if (strike.state === 'MATCHED') {
        if (!strike.match?.observation.observationId || !Number.isFinite(strike.match.observation.confidence)
          || !Number.isFinite(strike.match.timingOffsetMs)) throw new Error('Continuous assignment matched strike metadata is required.');
        claim({ kind: 'STRIKE_MATCH', observationId: strike.match.observation.observationId, strikeId: strike.strikeId }, strike.match.observation);
      }
    }
    for (const residual of residuals) {
      const strike = groupStrikes.find(strike => strike.strikeId === residual.strikeId);
      if (!strike || strike.state !== 'UNMATCHED' || residualSlots.has(residual.strikeId)
        || !Number.isFinite(residual.timingOffsetMs)
        || residual.timingOffsetMs !== residual.observation.performanceTimeMs - strike.expectedPerformanceTimeMs) {
        throw new Error('Continuous assignment residual strike assignment is corrupt.');
      }
      residualSlots.add(residual.strikeId);
      claim({ kind: 'GROUP_RESIDUAL', observationId: residual.observation.observationId, groupId: group.groupId, strikeId: strike.strikeId }, residual.observation);
    }
  }
  for (const row of assignment.unattributedObservations) {
    if (!row.finality) throw new Error('Continuous assignment unattributed observation must be final.');
    assertFinality(row.finality, completion);
    claim({ kind: 'UNATTRIBUTED', observationId: row.observation.observationId }, row.observation);
  }
  const relations = assignment.observationAssignments;
  const relatedIds = new Set(relations.map(row => row.observationId));
  if (relatedIds.size !== relations.length || relations.length !== ledger.size || declarations.size !== ledger.size
    || relations.some(row => !declarations.has(row.observationId)
      || relationKey(row) !== relationKey(declarations.get(row.observationId)!))) {
    throw new Error('Continuous assignment observation assignment is corrupt.');
  }
}

function assertFinality(value: CompletedContinuousAssignment['groups'][number]['finality'], completion: CompletedContinuousAssignment['completion']): void {
  const fields = ['requiredAnalysisFrontierMs', 'unclampedRequiredFrontierMs', 'enablingPublicationId',
    'enablingAnalysisFrontierMs', 'finalizationSessionTimeMs', 'terminalClamp'];
  if (Object.keys(value).sort().join() !== fields.sort().join() || !value.enablingPublicationId
    || typeof value.terminalClamp !== 'boolean'
    || ![value.requiredAnalysisFrontierMs, value.unclampedRequiredFrontierMs,
      value.enablingAnalysisFrontierMs, value.finalizationSessionTimeMs].every(time => Number.isFinite(time) && time >= 0)
    || value.requiredAnalysisFrontierMs > value.enablingAnalysisFrontierMs
    || value.requiredAnalysisFrontierMs > value.unclampedRequiredFrontierMs
    || (value.terminalClamp ? value.requiredAnalysisFrontierMs !== completion.performanceTimeMs
      || value.requiredAnalysisFrontierMs >= value.unclampedRequiredFrontierMs
      : value.requiredAnalysisFrontierMs !== value.unclampedRequiredFrontierMs)
    || value.finalizationSessionTimeMs > completion.availabilitySessionTimeMs) {
    throw new Error('Continuous assignment finality coordinates are corrupt.');
  }
}

function relationKey(relation: CompletedContinuousAssignment['observationAssignments'][number]): string {
  switch (relation.kind) {
    case 'STRIKE_MATCH': return JSON.stringify([relation.kind, relation.observationId, relation.strikeId]);
    case 'GROUP_RESIDUAL': return JSON.stringify([relation.kind, relation.observationId, relation.groupId, relation.strikeId]);
    case 'UNATTRIBUTED': return JSON.stringify([relation.kind, relation.observationId]);
    default: throw new Error('Continuous assignment observation assignment is corrupt.');
  }
}

function sameObservation(a: ContinuousObservation, b: ContinuousObservation): boolean {
  return a.observationId === b.observationId && a.pitch === b.pitch
    && a.performanceTimeMs === b.performanceTimeMs && a.confidence === b.confidence && a.source === b.source
    && Boolean(a.provenance) === Boolean(b.provenance)
    && a.provenance?.sourceDomainId === b.provenance?.sourceDomainId
    && a.provenance?.sourceEventSample === b.provenance?.sourceEventSample
    && a.provenance?.sourceSampleRateHz === b.provenance?.sourceSampleRateHz;
}
