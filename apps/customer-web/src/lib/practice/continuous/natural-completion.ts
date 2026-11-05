import type { ContinuousPracticeCompletion } from "./completion";
import type { ContinuousPracticeSessionSnapshot } from "./domain/session";
import { createContinuousPerformanceResult } from "@/lib/practice/result/continuous-performance-result";
import type { ContinuousEvidenceProvenance } from "@/lib/practice/result/continuous-result-provenance";
import type { CompletedContinuousEvaluation } from "./domain/evaluation/evaluation-types";
import type { PerformanceRecording } from "@/lib/practice/recording/recording-artifact";

export function createNaturalContinuousCompletion(options: {
  session: ContinuousPracticeSessionSnapshot;
  evaluation: CompletedContinuousEvaluation;
  evidenceProvenance: ContinuousEvidenceProvenance;
  recording: PerformanceRecording;
  completedAt: string;
}): ContinuousPracticeCompletion {
  if (options.session.completionReason !== "SCOPE_COMPLETED")
    throw new Error(
      "Continuous completion requires a naturally completed scope.",
    );
  const plan = options.session.plan;
  const result = createContinuousPerformanceResult({
    artifact: plan.source.artifact,
    scope: plan.scope,
    tempoPlan: plan.tempoPlan,
    sourceId: plan.source.sourceId,
    localSessionId: options.session.localSessionId,
    inputSource: plan.resources.input.kind,
    activeElapsedMs: options.session.performance.activeElapsedMs,
    evaluation: options.evaluation,
    evidenceProvenance: options.evidenceProvenance,
    completedAt: options.completedAt,
  });
  return Object.freeze({ result, recording: options.recording });
}
