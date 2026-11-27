import type { ContinuousPracticeCompletion } from "./completion";
import type { ContinuousPracticeSessionSnapshot } from "./domain/session";
import { createContinuousPerformanceResult } from "@/lib/practice/result/continuous-performance-result";
import type { CompletedContinuousEvaluation } from "./domain/evaluation/evaluation-types";
import type { PerformanceRecording } from "@/lib/practice/recording/recording-artifact";

export function createNaturalContinuousCompletion(options: {
  session: ContinuousPracticeSessionSnapshot;
  evaluation: CompletedContinuousEvaluation;
  recording: PerformanceRecording;
}): ContinuousPracticeCompletion {
  return Object.freeze({
    result: createContinuousPerformanceResult(options),
    recording: options.recording,
  });
}
