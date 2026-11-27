import { CONTINUOUS_ASSIGNMENT_POLICY_ID } from '@/lib/practice/continuous/domain/evaluation/finalization-policy';
import type { PracticeInputSource } from '@/lib/practice/planning/intent';
import type { CompletedContinuousEvaluation } from '@/lib/practice/continuous/domain/evaluation/evaluation-types';
import type { ContinuousFinality, FinalizedContinuousGroupAssignment, ContinuousObservationAssignment, CompletedContinuousAssignment } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
import type { ContinuousObservation } from '@/lib/practice/continuous/domain/evaluation/evidence-types';
export const finality: ContinuousFinality = Object.freeze({ requiredAnalysisFrontierMs: 1250, unclampedRequiredFrontierMs: 1250,
  enablingPublicationId: 'fixture', enablingAnalysisFrontierMs: 10000, finalizationSessionTimeMs: 10000, terminalClamp: false });
export function completedEvaluationFixture(inputSource: PracticeInputSource, groups: readonly FinalizedContinuousGroupAssignment[] = [], unattributed: readonly ContinuousObservation[] = []): CompletedContinuousEvaluation {
  const observationAssignments: ContinuousObservationAssignment[] = [...groups.flatMap(group => [
    ...group.strikes.flatMap(strike => strike.state === 'MATCHED' ? [{ kind: 'STRIKE_MATCH' as const, observationId: strike.match.observation.observationId, strikeId: strike.strikeId }] : []),
  ]), ...unattributed.map(observation => ({ kind: 'UNATTRIBUTED' as const, observationId: observation.observationId }))];
  const observations = [...groups.flatMap(group => [ ...group.strikes.flatMap(strike => strike.state === 'MATCHED' ? [strike.match.observation] : []) ]), ...unattributed];
  const assignment: CompletedContinuousAssignment = { sessionDomainId: 'fixture', observations, groups,
    unattributedObservations: unattributed.map(observation => ({ observation, finality })), observationAssignments,
    completion: { reason: 'SCOPE_COMPLETED', performanceTimeMs: 10000, availabilitySessionTimeMs: 10000 } };
  return { status: 'COMPLETE', inputSource, assignmentPolicyId: CONTINUOUS_ASSIGNMENT_POLICY_ID, assignment };
}
