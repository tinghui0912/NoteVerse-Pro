import type { ContinuousPracticeCompletion } from './completion';
import type { LocalPerformanceSessionSnapshot } from './domain/session';
import { createContinuousPerformanceResult } from '@/lib/practice/result/continuous-performance-result';
import type { ContinuousEvidenceProvenance } from '@/lib/practice/result/continuous-result-provenance';
import type { CompletedContinuousEvaluation } from './domain/evaluation/evaluation-types';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import type { PracticeScope } from '@/lib/practice/kernel/scope';
import type { ResolvedPracticeTempoPlan } from '@/lib/practice/kernel/tempo';
import type { PerformanceRecording } from '@/lib/practice/recording/recording-artifact';

export function createNaturalContinuousCompletion(options: {
  session: LocalPerformanceSessionSnapshot; artifact: PracticeScoreArtifact; scope: PracticeScope;
  tempoPlan: ResolvedPracticeTempoPlan; evaluation: CompletedContinuousEvaluation;
  evidenceProvenance: ContinuousEvidenceProvenance; recording: PerformanceRecording; completedAt: string;
}): ContinuousPracticeCompletion {
  if (options.session.completionReason !== 'SCOPE_COMPLETED') throw new Error('Continuous completion requires a naturally completed scope.');
  const result = createContinuousPerformanceResult({ artifact: options.artifact, scope: options.scope, tempoPlan: options.tempoPlan,
    localSessionId: options.session.localSessionId, inputSource: options.session.inputSource,
    activeElapsedMs: options.session.performance.activeElapsedMs, evaluation: options.evaluation,
    evidenceProvenance: options.evidenceProvenance, completedAt: options.completedAt });
  return Object.freeze({ result, recording: options.recording });
}
