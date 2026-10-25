import type { CompletedContinuousEvaluation, ContinuousFinality, ContinuousFinalizedGroup, ContinuousObservation } from '@/lib/practice/continuous/domain/evaluation/types';
export const finality: ContinuousFinality = Object.freeze({ requiredAnalysisFrontierMs: 1250, unclampedRequiredFrontierMs: 1250,
  enablingPublicationId: 'fixture', enablingAnalysisFrontierMs: 10000, finalizationTimeMs: 10000, terminalClamp: false });
export function completedTruth(groups: readonly ContinuousFinalizedGroup[] = [], extraObservations: readonly ContinuousObservation[] = []): CompletedContinuousEvaluation {
  return { status: 'COMPLETE', sessionDomainId: 'fixture', groups,
    extras: extraObservations.map(observation => ({ verdict: 'EXTRA', observation, finality })),
    completion: { reason: 'SCOPE_COMPLETED', performanceTimeMs: 10000, availabilityTimeMs: 10000 },
    observationOwnership: [
      ...groups.flatMap(group => [
        ...group.strikes.flatMap(strike => strike.state === 'MATCHED' ? [{ observationId: strike.match.observation.observationId, disposition: 'MATCHED' as const, ownerId: strike.strikeId }] : []),
        ...group.wrongObservations.map(observation => ({ observationId: observation.observationId, disposition: 'WRONG' as const, ownerId: group.groupId })),
      ]), ...extraObservations.map(observation => ({ observationId: observation.observationId, disposition: 'EXTRA' as const, ownerId: observation.observationId })),
    ],
  };
}
