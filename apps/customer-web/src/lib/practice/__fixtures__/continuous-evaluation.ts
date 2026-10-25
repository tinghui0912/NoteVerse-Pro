import type { PracticeInputSource } from '@/lib/practice/kernel/session';
import type { CompletedContinuousEvaluation } from '@/lib/practice/continuous/domain/evaluation/evaluation-types';
import type { ContinuousFinality, FinalizedContinuousGroupAssignment, ContinuousObservationAssignment, CompletedContinuousAssignment } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
import type { ContinuousObservation } from '@/lib/practice/continuous/domain/evaluation/evidence-types';
import { interpretContinuousAssignment } from '@/lib/practice/continuous/domain/evaluation/interpretation';
export const finality: ContinuousFinality = Object.freeze({ requiredAnalysisFrontierMs: 1250, unclampedRequiredFrontierMs: 1250,
  enablingPublicationId: 'fixture', enablingAnalysisFrontierMs: 10000, finalizationTimeMs: 10000, terminalClamp: false });
export function completedEvaluationFixture(inputSource: PracticeInputSource, groups: readonly FinalizedContinuousGroupAssignment[] = [], unattributed: readonly ContinuousObservation[] = []): CompletedContinuousEvaluation {
  const observationAssignments: ContinuousObservationAssignment[] = [...groups.flatMap(group => [
    ...group.strikes.flatMap(strike => strike.state === 'MATCHED' ? [{ kind: 'STRIKE_MATCH' as const, observationId: strike.match.observation.observationId, strikeId: strike.strikeId }] : []),
    ...group.residualObservations.map(observation => ({ kind: 'GROUP_RESIDUAL' as const, observationId: observation.observationId, groupId: group.groupId })),
  ]), ...unattributed.map(observation => ({ kind: 'UNATTRIBUTED' as const, observationId: observation.observationId }))];
  const observations = [...groups.flatMap(group => [ ...group.strikes.flatMap(strike => strike.state === 'MATCHED' ? [strike.match.observation] : []), ...group.residualObservations ]), ...unattributed];
  const assignment: CompletedContinuousAssignment = { sessionDomainId: 'fixture', observations, groups,
    unattributedObservations: unattributed.map(observation => ({ observation, finality })), observationAssignments,
    completion: { reason: 'SCOPE_COMPLETED', performanceTimeMs: 10000, availabilityTimeMs: 10000 } };
  const interpretation = interpretContinuousAssignment(assignment, inputSource);
  return interpretation.inputSource === 'MIDI'
    ? { status: 'COMPLETE', inputSource: 'MIDI', policyId: 'MIDI_PHYSICAL_NOTE_EVENTS_V1', assignment, interpretation }
    : { status: 'COMPLETE', inputSource: 'MICROPHONE', policyId: 'ACOUSTIC_CONSERVATIVE_SUPPORT_V1', assignment, interpretation };
}
