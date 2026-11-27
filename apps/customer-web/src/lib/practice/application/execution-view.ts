import type { PracticePlan } from "@/lib/practice/planning/practice-plan";
import type { LocalPracticeInputState } from "@/lib/practice/input-state";
import { projectPracticeMomentView } from "@/lib/practice/score-view/moment-view";
import {
  ownedExecution,
  type PracticeExecutionActorState,
} from "./execution-machine";
import type {
  ExecutionFailure,
  ExecutionObservation,
} from "./execution-observation";

export type PracticeExecutionLifecycle =
  | "READY"
  | "PREPARING"
  | "ACTIVE"
  | "PAUSED"
  | "FINALIZING"
  | "COMPLETED"
  | "ERROR";
export type PracticeExecutionErrorCode = ExecutionFailure["code"];
type CommonView = Readonly<{
  lifecycle: PracticeExecutionLifecycle;
  inputState: LocalPracticeInputState;
  executedPlan: PracticePlan | null;
  canStart: boolean;
}>;
type StepObservation = Extract<ExecutionObservation, { mode: "STEP_BY_STEP" }>;
type ContinuousObservation = Extract<
  ExecutionObservation,
  { mode: "CONTINUOUS_PLAY" }
>;
export type PracticeExecutionView = CommonView &
  (
    | Readonly<{
        mode: "STEP_BY_STEP";
        inputError: StepObservation["error"];
        completion: null;
        activeStepGroup: ReturnType<typeof projectPracticeMomentView> | null;
        stepInteractionPhase: StepObservation["stepInteractionPhase"];
        pendingPostVerdict: StepObservation["pendingPostVerdict"];
        canAcceptAttempt: boolean;
        analysisIntervention: StepObservation["analysisIntervention"];
        infrastructureIntervention: StepObservation["infrastructureIntervention"];
        performanceClock: null;
        performanceEvaluation: null;
        recordingIndicator: null;
      }>
    | Readonly<{
        mode: "CONTINUOUS_PLAY";
        inputError: ContinuousObservation["error"];
        completion: ContinuousObservation["completion"];
        activeStepGroup: null;
        performanceClock: ContinuousObservation["transport"];
        performanceEvaluation: ContinuousObservation["evaluation"];
        recordingIndicator: number | null;
        analysisIntervention: ContinuousObservation["analysisIntervention"];
        resourceIntervention: ContinuousObservation["resourceIntervention"];
      }>
  );
/** Deterministic projection of accepted machine state; never reads a controller. */
export function projectExecutionView(
  state: PracticeExecutionActorState,
): PracticeExecutionView {
  const execution = ownedExecution(state);
  const failure = state.tag === "ERROR" ? state.error.failure : null;
  const plan = execution?.plan ?? state.candidate.plan;
  const leaf = execution?.observation;
  const mode =
    execution?.plan.mode ?? failure?.mode ?? plan?.mode ?? "STEP_BY_STEP";
  const lifecycle: PracticeExecutionLifecycle =
    state.tag === "ERROR"
      ? "ERROR"
      : state.tag === "COMPLETED"
        ? "COMPLETED"
        : state.tag === "STARTING"
          ? "PREPARING"
          : state.tag === "RUNNING"
            ? leaf?.mode === "CONTINUOUS_PLAY"
              ? leaf.phase
              : leaf?.error
                ? "ERROR"
                : "ACTIVE"
            : "READY";
  const error = failure?.code ?? leaf?.error ?? null;
  const common: CommonView = {
    lifecycle,
    executedPlan: execution?.plan ?? null,
    canStart:
      state.tag === "READY" &&
      state.candidate.admitted &&
      Boolean(state.candidate.plan),
    inputState:
      lifecycle === "PREPARING"
        ? "STARTING"
        : error || lifecycle === "ERROR"
          ? "ERROR"
          : lifecycle === "ACTIVE"
            ? "RUNNING"
            : "IDLE",
  };
  if (mode === "CONTINUOUS_PLAY") {
    const snapshot = leaf?.mode === mode ? leaf : null;
    return Object.freeze({
      ...common,
      mode,
      inputError:
        failure?.mode === mode ? failure.code : (snapshot?.error ?? null),
      completion:
        state.tag === "COMPLETED" ? (snapshot?.completion ?? null) : null,
      activeStepGroup: null,
      performanceClock: snapshot?.transport ?? null,
      performanceEvaluation: snapshot?.evaluation ?? null,
      recordingIndicator: snapshot?.recordingIndicator ?? null,
      analysisIntervention: snapshot?.analysisIntervention ?? null,
      resourceIntervention: snapshot?.resourceIntervention ?? null,
    });
  }
  const snapshot = leaf?.mode === mode ? leaf : null;
  return Object.freeze({
    ...common,
    mode,
    inputError:
      failure?.mode === mode ? failure.code : (snapshot?.error ?? null),
    completion: null,
    activeStepGroup:
      snapshot?.activeStepGroup && plan
        ? projectPracticeMomentView(
            plan.bundle.artifact,
            snapshot.activeStepGroup,
          )
        : null,
    stepInteractionPhase: snapshot?.stepInteractionPhase ?? null,
    pendingPostVerdict: snapshot?.pendingPostVerdict ?? null,
    canAcceptAttempt: snapshot?.canAcceptAttempt ?? false,
    analysisIntervention: snapshot?.analysisIntervention ?? null,
    infrastructureIntervention: snapshot?.infrastructureIntervention ?? null,
    performanceClock: null,
    performanceEvaluation: null,
    recordingIndicator: null,
  });
}

/** Keep external-store snapshots stable when only candidate data changes during execution. */
export function sameExecutionView(
  a: PracticeExecutionView,
  b: PracticeExecutionView,
): boolean {
  return Object.keys(a).every((key) => {
    if (key !== "activeStepGroup")
      return Object.is(Reflect.get(a, key), Reflect.get(b, key));
    const x = a.activeStepGroup,
      y = b.activeStepGroup;
    if (x === y) return true;
    return Boolean(
      x &&
        y &&
        x.groupId === y.groupId &&
        x.onsetTick === y.onsetTick &&
        x.canonicalEndTick === y.canonicalEndTick &&
        x.renderNoteIds.length === y.renderNoteIds.length &&
        x.renderNoteIds.every((value, i) => value === y.renderNoteIds[i]) &&
        x.measureNumbers.length === y.measureNumbers.length &&
        x.measureNumbers.every((value, i) => value === y.measureNumbers[i]),
    );
  });
}
