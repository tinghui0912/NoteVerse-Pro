import artifactJson from './canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '@/lib/practice/score/artifact';
import { continuousPracticePlan } from './practice-plan';
import type { ContinuousPracticePlan } from '@/lib/practice/planning/practice-plan';
import type { CompletedContinuousPracticeSessionSnapshot } from '@/lib/practice/result/continuous-performance-result';
import { createContinuousPerformanceResult } from '@/lib/practice/result/continuous-performance-result';
import {
  ContinuousEvaluationSession,
  unavailableContinuousEvaluation,
} from '@/lib/practice/continuous/domain/evaluation/session';
import type { PracticeInputSource } from '@/lib/practice/planning/intent';

export function completedContinuousSessionFixture(
  plan: ContinuousPracticePlan,
  options: {
    localSessionId?: string;
    activeElapsedMs?: number;
    updatedAtMs?: number;
  } = {},
): CompletedContinuousPracticeSessionSnapshot {
  return Object.freeze({
    localSessionId: options.localSessionId ?? 'result-fixture',
    plan,
    completionReason: 'SCOPE_COMPLETED',
    lifecycleState: 'ENDED',
    createdAtMs: Date.UTC(2026, 8, 20),
    updatedAtMs: options.updatedAtMs ?? Date.UTC(2026, 8, 20, 0, 0, 10),
    performance: Object.freeze({
      state: 'ENDED',
      stateBeforePause: 'RUNNING',
      activeElapsedMs: options.activeElapsedMs ?? 10000,
      metronomeEnabled: plan.metronomePlan.initiallyEnabled,
      countInMs: 0,
      countInTicks: plan.countIn.durationTicks,
      countInPulses: plan.countIn.pulses,
    }),
  });
}

export function canonicalContinuousCompletionInputFixture(
  inputSource: PracticeInputSource = 'MIDI',
  available = true,
) {
  const plan = continuousPracticePlan(artifactJson as PracticeScoreArtifact, {
    inputSource,
  });
  const session = completedContinuousSessionFixture(plan);
  const evaluator = new ContinuousEvaluationSession({
    artifact: plan.bundle.artifact,
    scope: plan.scope,
    inputSource,
    sessionDomainId: session.localSessionId,
    timeline: { tickToTimeMs: (tick) => tick * 500 },
  });
  evaluator.publish({
    publicationId: 'coverage',
    sessionDomainId: session.localSessionId,
    analyzedThroughPerformanceMs: 10000,
    availabilitySessionTimeMs: 10000,
    observations: [],
  });
  evaluator.complete({
    reason: 'SCOPE_COMPLETED',
    performanceTimeMs: 10000,
    availabilitySessionTimeMs: 10000,
  });
  return {
    session,
    evaluation: available
      ? evaluator.completedEvaluation()
      : unavailableContinuousEvaluation(
          inputSource,
          'CONTINUOUS_ANALYSIS_UNAVAILABLE',
        ),
  };
}

export function canonicalContinuousResultFixture(
  inputSource: PracticeInputSource = 'MIDI',
  available = true,
) {
  return createContinuousPerformanceResult(
    canonicalContinuousCompletionInputFixture(inputSource, available),
  );
}
