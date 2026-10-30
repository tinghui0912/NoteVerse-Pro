import { isPracticePianoKey } from '@/lib/practice/kernel/piano-key';
import type { ContinuousAssignmentSnapshot } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
import type { CompletedContinuousAssignment, CompletedContinuousAssignmentResult, FinalizedContinuousGroupAssignment, FinalizedContinuousStrikeAssignment } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
import type { ContinuousObservation } from '@/lib/practice/continuous/domain/evaluation/evidence-types';
import { immutableContinuousValue } from '@/lib/practice/continuous/domain/evaluation/immutable-value';
import { withinContinuousWindow } from '@/lib/practice/continuous/domain/evaluation/finalization-policy';

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
  if (!hasRetainedFields(assignment, ['sessionDomainId', 'observations', 'groups', 'unattributedObservations', 'observationAssignments', 'completion'])
    || !isRetainedIdentity(assignment.sessionDomainId)
    || !Array.isArray(assignment.groups) || !Array.isArray(assignment.observations)
    || !Array.isArray(assignment.unattributedObservations) || !Array.isArray(assignment.observationAssignments)
    || !assignment.completion) throw new Error('Continuous assignment assignment is corrupt.');
  const completion = assignment.completion;
  if (!hasRetainedFields(completion, ['reason', 'performanceTimeMs', 'availabilitySessionTimeMs'])
    || !['SCOPE_COMPLETED', 'STOPPED_BY_USER'].includes(completion.reason)
    || !Number.isFinite(completion.performanceTimeMs) || completion.performanceTimeMs < 0
    || !Number.isFinite(completion.availabilitySessionTimeMs) || completion.availabilitySessionTimeMs < 0) {
    throw new Error('Continuous assignment completion coordinates are corrupt.');
  }
  const ledger = new Map<string, ContinuousObservation>();
  for (const observation of assignment.observations) {
    assertRetainedObservation(observation, completion.performanceTimeMs);
    if (ledger.has(observation.observationId)) throw new Error('Continuous assignment observation assignment is corrupt.');
    ledger.set(observation.observationId, observation);
  }
  const declarations = new Map<string, CompletedContinuousAssignment['observationAssignments'][number]>();
  const groups = new Set<string>(), strikes = new Set<string>();
  const claim = (relation: CompletedContinuousAssignment['observationAssignments'][number], observation: ContinuousObservation) => {
    assertRetainedObservation(observation, completion.performanceTimeMs);
    const retained = ledger.get(observation.observationId);
    if (!retained || !sameObservation(retained, observation) || declarations.has(observation.observationId)) {
      throw new Error('Continuous assignment observation assignment is corrupt.');
    }
    declarations.set(observation.observationId, relation);
  };
  for (const group of assignment.groups) {
    if (!hasRetainedFields(group, ['groupId', 'performanceTimeMs', 'state', 'strikes', 'finality'])
      || group.state !== 'FINALIZED' || !group.finality || !Array.isArray(group.strikes) || !group.strikes.length
      || !isRetainedIdentity(group.groupId) || groups.has(group.groupId)
      || !Number.isFinite(group.performanceTimeMs) || group.performanceTimeMs < 0) {
      throw new Error('Continuous assignment group must be final and unique.');
    }
    groups.add(group.groupId);
    assertFinality(group.finality, completion);
    const groupStrikes: readonly FinalizedContinuousStrikeAssignment[] = group.strikes;
    for (const strike of groupStrikes) {
      if (strike && !Array.isArray(strike.renderNoteIds)) throw new Error('Continuous assignment strike renderNoteIds are required.');
      const fields = ['strikeId', 'groupId', 'pianoKey', 'expectedPerformanceTimeMs', 'renderNoteIds', 'state', 'finality'];
      if (!hasRetainedFields(strike, strike?.state === 'MATCHED' ? [...fields, 'match'] : fields)
        || !['MATCHED', 'UNMATCHED', 'NOT_REACHED'].includes(strike.state) || !strike.finality) {
        throw new Error('Continuous assignment strike must be final.');
      }
      for (const id of strike.renderNoteIds) {
        if (!isRetainedIdentity(id)) throw new Error('Continuous assignment strike renderNoteIds are corrupt.');
      }
      if (!isRetainedIdentity(strike.strikeId) || !isRetainedIdentity(strike.groupId) || !isPracticePianoKey(strike.pianoKey)
        || !Number.isFinite(strike.expectedPerformanceTimeMs) || strike.expectedPerformanceTimeMs < 0
        || strike.expectedPerformanceTimeMs !== group.performanceTimeMs
        || strikes.has(strike.strikeId) || strike.groupId !== group.groupId) {
        throw new Error('Continuous assignment strike identity is corrupt.');
      }
      strikes.add(strike.strikeId);
      assertFinality(strike.finality, completion);
      if (group.finality.finalizationSessionTimeMs < strike.finality.finalizationSessionTimeMs
        || group.finality.enablingAnalysisFrontierMs < strike.finality.enablingAnalysisFrontierMs) {
        throw new Error('Continuous assignment group precedes child strike finality.');
      }
      if (strike.state === 'MATCHED') {
        if (!hasRetainedFields(strike.match, ['observation', 'timingOffsetMs'])
          || !Number.isFinite(strike.match.timingOffsetMs)) throw new Error('Continuous assignment matched strike metadata is required.');
        assertRetainedObservation(strike.match.observation, completion.performanceTimeMs);
        if (strike.match.observation.pianoKey !== strike.pianoKey
          || strike.match.timingOffsetMs !== strike.match.observation.performanceTimeMs - strike.expectedPerformanceTimeMs
          || !withinContinuousWindow(strike.expectedPerformanceTimeMs, strike.match.observation.performanceTimeMs)) {
          throw new Error('Continuous assignment matched strike semantics are corrupt.');
        }
        claim({ kind: 'STRIKE_MATCH', observationId: strike.match.observation.observationId, strikeId: strike.strikeId }, strike.match.observation);
      }
    }
  }
  for (const row of assignment.unattributedObservations) {
    if (!hasRetainedFields(row, ['observation', 'finality']) || !row.finality) {
      throw new Error('Continuous assignment unattributed observation must be final.');
    }
    assertFinality(row.finality, completion);
    assertRetainedObservation(row.observation, completion.performanceTimeMs);
    claim({ kind: 'UNATTRIBUTED', observationId: row.observation.observationId }, row.observation);
  }
  const relations = assignment.observationAssignments;
  for (const relation of relations) assertRetainedObservationAssignment(relation);
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
  if (!hasRetainedFields(value, fields)) throw new Error('Continuous assignment finality coordinates are corrupt.');
  const expectedRequired = Math.min(value.unclampedRequiredFrontierMs, completion.performanceTimeMs);
  const expectedClamp = value.unclampedRequiredFrontierMs > completion.performanceTimeMs;
  if (!isRetainedIdentity(value.enablingPublicationId)
    || typeof value.terminalClamp !== 'boolean'
    || ![value.requiredAnalysisFrontierMs, value.unclampedRequiredFrontierMs,
      value.enablingAnalysisFrontierMs, value.finalizationSessionTimeMs].every(time => Number.isFinite(time) && time >= 0)
    || value.requiredAnalysisFrontierMs > value.enablingAnalysisFrontierMs
    || value.enablingAnalysisFrontierMs > completion.performanceTimeMs
    || value.requiredAnalysisFrontierMs > value.unclampedRequiredFrontierMs
    || value.requiredAnalysisFrontierMs !== expectedRequired
    || value.terminalClamp !== expectedClamp
    || value.finalizationSessionTimeMs > completion.availabilitySessionTimeMs) {
    throw new Error('Continuous assignment finality coordinates are corrupt.');
  }
}

/** Private to the completed-assignment boundary; no normalization or schema fallback. */
function hasRetainedFields(value: unknown, fields: readonly string[]): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every(field => Object.prototype.hasOwnProperty.call(value, field));
}

function isRetainedIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function assertRetainedObservation(value: ContinuousObservation, terminalPerformanceMs: number): void {
  const fields = ['observationId', 'pianoKey', 'performanceTimeMs', 'confidence', 'source'];
  const hasProvenance = value && Object.prototype.hasOwnProperty.call(value, 'provenance');
  if (hasProvenance) fields.push('provenance');
  if (!hasRetainedFields(value, fields) || !isRetainedIdentity(value.observationId) || !isPracticePianoKey(value.pianoKey)
    || !Number.isFinite(value.performanceTimeMs) || value.performanceTimeMs < 0 || value.performanceTimeMs > terminalPerformanceMs
    || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1
    || !['MIDI', 'ACOUSTIC'].includes(value.source)) {
    throw new Error('Continuous assignment observation is corrupt.');
  }
  if (hasProvenance) {
    const p = value.provenance;
    if (!hasRetainedFields(p, ['sourceDomainId', 'sourceSampleRateHz', 'sourceEventSample'])
      || !p || !isRetainedIdentity(p.sourceDomainId) || !Number.isFinite(p.sourceSampleRateHz) || p.sourceSampleRateHz <= 0
      || !Number.isFinite(p.sourceEventSample) || p.sourceEventSample < 0) {
      throw new Error('Continuous assignment observation provenance is corrupt.');
    }
  }
}

function assertRetainedObservationAssignment(value: CompletedContinuousAssignment['observationAssignments'][number]): void {
  const kind = value?.kind;
  const fields = kind === 'STRIKE_MATCH' ? ['kind', 'observationId', 'strikeId']
      : kind === 'UNATTRIBUTED' ? ['kind', 'observationId'] : null;
  if (!fields || !hasRetainedFields(value, fields) || !isRetainedIdentity(value.observationId)
    || value.kind !== 'UNATTRIBUTED' && !isRetainedIdentity(value.strikeId)) {
    throw new Error('Continuous assignment observation assignment is corrupt.');
  }
}

function relationKey(relation: CompletedContinuousAssignment['observationAssignments'][number]): string {
  switch (relation.kind) {
    case 'STRIKE_MATCH': return JSON.stringify([relation.kind, relation.observationId, relation.strikeId]);
    case 'UNATTRIBUTED': return JSON.stringify([relation.kind, relation.observationId]);
    default: throw new Error('Continuous assignment observation assignment is corrupt.');
  }
}

function sameObservation(a: ContinuousObservation, b: ContinuousObservation): boolean {
  return a.observationId === b.observationId && a.pianoKey === b.pianoKey
    && a.performanceTimeMs === b.performanceTimeMs && a.confidence === b.confidence && a.source === b.source
    && Boolean(a.provenance) === Boolean(b.provenance)
    && a.provenance?.sourceDomainId === b.provenance?.sourceDomainId
    && a.provenance?.sourceEventSample === b.provenance?.sourceEventSample
    && a.provenance?.sourceSampleRateHz === b.provenance?.sourceSampleRateHz;
}
