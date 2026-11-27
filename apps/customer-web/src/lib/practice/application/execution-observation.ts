import type { StepApplicationErrorCode } from "@/lib/practice/step/step-errors";
import type { ContinuousErrorCode } from "@/lib/practice/continuous/continuous-errors";
import type { PracticeMoment } from "@/lib/practice/score/artifact";
import type { StepPracticeSessionSnapshot } from "@/lib/practice/step/domain/session";
import type { ContinuousPracticeSessionSnapshot } from "@/lib/practice/continuous/domain/session";
import type { StepAnalysisIntervention } from "@/lib/practice/step/step-analysis-intervention";
import type { StepInfrastructureIntervention } from "@/lib/practice/step/step-infrastructure-intervention";
import type { ContinuousAnalysisIntervention } from "@/lib/practice/continuous/analysis-intervention";
import type { PracticeResourceIntervention } from "@/lib/practice/continuous/resource-intervention";
import type { ContinuousPracticeCompletion } from "@/lib/practice/continuous/completion";
import type { PerformanceClockSnapshot } from "@/lib/practice/continuous/domain/performance-clock";
import type { ContinuousTargetFeedback } from "@/lib/practice/continuous/domain/evaluation/target-feedback";

export type ExecutionCompletion =
  | StepPracticeSessionSnapshot
  | ContinuousPracticeSessionSnapshot;
export type ExecutionFailure = Readonly<
  (
    | { mode: "STEP_BY_STEP"; code: StepApplicationErrorCode }
    | { mode: "CONTINUOUS_PLAY"; code: ContinuousErrorCode }
  ) & { cause?: unknown }
>;
/** Immutable application observations, without controller handles or browser resources. */
export type ExecutionObservation =
  | Readonly<{
      mode: "STEP_BY_STEP";
      error: StepApplicationErrorCode | null;
      activeStepGroup: PracticeMoment | null;
      stepInteractionPhase:
        | StepPracticeSessionSnapshot["step"]["attemptState"]
        | null;
      pendingPostVerdict: StepPracticeSessionSnapshot["step"]["pendingPostVerdict"];
      canAcceptAttempt: boolean;
      analysisIntervention: StepAnalysisIntervention | null;
      infrastructureIntervention: StepInfrastructureIntervention | null;
    }>
  | Readonly<{
      mode: "CONTINUOUS_PLAY";
      error: ContinuousErrorCode | null;
      phase: "PREPARING" | "ACTIVE" | "PAUSED" | "FINALIZING" | "ERROR";
      transport: PerformanceClockSnapshot | null;
      evaluation: ContinuousTargetFeedback | null;
      recordingIndicator: number | null;
      analysisIntervention: ContinuousAnalysisIntervention | null;
      resourceIntervention: PracticeResourceIntervention | null;
      completion: ContinuousPracticeCompletion | null;
    }>;
