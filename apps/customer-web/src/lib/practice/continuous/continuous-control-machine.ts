import type { ContinuousErrorCode } from "./continuous-errors";
import type { PerformanceClockSnapshot } from "./domain/performance-clock";
import type { MicrophoneResourceHealth } from "./microphone-resource-health";
import type { RecordingRuntimeInterruption } from "@/lib/practice/recording/recording-runtime-fault";
import type { ContinuousPracticeCompletion } from "./completion";
import type { ContinuousPracticeSessionSnapshot } from "./domain/session";
import type { PracticeResourceIntervention } from "./resource-intervention";
import type { ContinuousEvidencePublication } from "./domain/evaluation/evidence-types";
import type { ContinuousMidiAttack } from "./domain/clock-evidence-port";

type ContinuousAnalysisControl =
  | Readonly<{
      kind: "NOT_REQUIRED" | "PREPARING" | "ACTIVE" | "DRAINING" | "COMPLETE";
    }>
  | Readonly<{
      kind: "INTERRUPTED";
      code: ContinuousErrorCode;
      release: Readonly<{
        operationId: number;
        status: "PENDING" | "RELEASED";
      }>;
      choice: "WAITING" | "CONTINUE";
    }>
  | Readonly<{
      kind: "DISABLED" | "UNAVAILABLE_AFTER_TERMINAL" | "FAILED_FATAL";
      code: ContinuousErrorCode;
    }>;
type ContinuousResourceFacts = Readonly<{
  input: MicrophoneResourceHealth | null;
  midi: "HEALTHY" | "LOST" | "RECOVERED";
  recording: RecordingRuntimeInterruption | null;
  action:
    | Readonly<{ kind: "NONE" }>
    | Readonly<{ kind: "ACCEPT_RECORDING" | "RECOVER"; operationId: number }>;
}>;
type Configuration = Readonly<{
  analysisRequired: boolean;
  input: "MICROPHONE" | "MIDI";
  recording: "OFF" | "AUDIO" | "VIDEO";
}>;
type Shared = Readonly<{
  configuration: Configuration;
  nextOperationId: number;
  attemptId: number;
  analysis: ContinuousAnalysisControl;
  resources: ContinuousResourceFacts;
  pauseOwnership: "NONE" | "USER" | "INTERVENTION";
  transport: Readonly<PerformanceClockSnapshot> | null;
  metronomeEnabled: boolean;
}>;
type Releasing =
  | Readonly<{ kind: "RELEASING"; operationId: number }>
  | Readonly<{ kind: "RELEASED" }>;
export type ContinuousControlState = Shared &
  (
    | Readonly<{ tag: "IDLE" }>
    | Readonly<{ tag: "PREPARING"; operationId: number }>
    | Readonly<{
        tag: "ACTIVE";
        transportAction: "NONE" | "START" | "REFRESH" | "PAUSE" | "RESUME";
        recordingEntry:
          | Readonly<{ kind: "INITIAL" | "SETTLED" }>
          | Readonly<{ kind: "RESUME"; performanceTimeMs: number }>;
      }>
    | Readonly<{
        tag: "FINALIZING";
        operationId: number;
        workflow:
          | Readonly<{ stage: "DRAINING" }>
          | Readonly<{
              stage: "CLEANUP";
              completion: ContinuousPracticeCompletion;
              session: ContinuousPracticeSessionSnapshot;
            }>;
      }>
    | Readonly<{
        tag: "COMPLETE";
        completion: ContinuousPracticeCompletion;
        session: ContinuousPracticeSessionSnapshot;
      }>
    | Readonly<{
        tag: "FAILED";
        failure: Readonly<{
          origin: "PREPARATION" | "ACTIVE" | "CLEANUP";
          code: ContinuousErrorCode;
          cause?: unknown;
        }>;
        release: Releasing;
      }>
    | Readonly<{ tag: "ABANDONED" | "DISPOSED"; release: Releasing }>
  );
export type ContinuousControlEvent =
  | Readonly<{
      type:
        | "START_REQUESTED"
        | "PAUSE_REQUESTED"
        | "RESUME_REQUESTED"
        | "REFRESH_REQUESTED"
        | "ABANDON_REQUESTED"
        | "DISPOSE_REQUESTED"
        | "CONTINUE_ANALYSIS_REQUESTED"
        | "CONTINUE_RECORDING_REQUESTED"
        | "RECOVERY_REQUESTED";
    }>
  | Readonly<{ type: "METRONOME_REQUESTED"; enabled: boolean }>
  | Readonly<{ type: "PREPARED"; operationId: number }>
  | Readonly<{
      type: "PREPARATION_FAILED";
      operationId: number;
      code: ContinuousErrorCode;
      analysisFailure: boolean;
      cause?: unknown;
    }>
  | Readonly<{
      type: "TRANSPORT_OBSERVED";
      attemptId: number;
      action: "START" | "REFRESH" | "PAUSE" | "RESUME" | "EVIDENCE" | "ABANDON";
      transport: Readonly<PerformanceClockSnapshot>;
    }>
  | Readonly<{
      type: "ANALYSIS_FAILED";
      attemptId: number;
      code: ContinuousErrorCode;
    }>
  | Readonly<{
      type: "INPUT_HEALTH_OBSERVED";
      attemptId: number;
      health: MicrophoneResourceHealth;
    }>
  | Readonly<{
      type: "RESOURCE_FACTS_OBSERVED";
      attemptId: number;
      midiHealthy: boolean;
      recording: RecordingRuntimeInterruption | null;
    }>
  | Readonly<{ type: "ROOTS_CHANGED"; attemptId: number }>
  | Readonly<{ type: "ANALYSIS_RELEASED"; operationId: number }>
  | Readonly<{
      type:
        | "ANALYSIS_RELEASE_FAILED"
        | "RESOURCE_ACTION_FAILED"
        | "FINALIZATION_FAILED";
      operationId: number;
      code: ContinuousErrorCode;
      cause?: unknown;
    }>
  | Readonly<{
      type: "RESOURCE_ACTION_FINISHED";
      operationId: number;
      success: boolean;
      recording: RecordingRuntimeInterruption | null;
    }>
  | Readonly<{
      type: "FATAL_FAILED";
      attemptId: number;
      code: ContinuousErrorCode;
      cause?: unknown;
    }>
  | Readonly<{
      type: "CLEANUP_FINISHED";
      operationId: number;
      failure?: unknown;
    }>
  | Readonly<{
      type: "FINALIZED";
      operationId: number;
      completion: ContinuousPracticeCompletion;
      session: ContinuousPracticeSessionSnapshot;
    }>
  | Readonly<{
      type: "ANALYSIS_PUBLICATION";
      attemptId: number;
      publication: ContinuousEvidencePublication;
    }>
  | Readonly<{
      type: "MIDI_ATTACK";
      attemptId: number;
      attack: ContinuousMidiAttack;
    }>;
export type ContinuousControlEffect =
  | Readonly<{ kind: "PREPARE"; operationId: number }>
  | Readonly<{
      kind:
        | "START_TRANSPORT"
        | "REFRESH_TRANSPORT"
        | "PAUSE_TRANSPORT"
        | "RESUME_TRANSPORT"
        | "ABANDON_TRANSPORT";
      attemptId: number;
    }>
  | Readonly<{
      kind: "START_RECORDING" | "RESUME_RECORDING";
      performanceTimeMs: number;
    }>
  | Readonly<{
      kind: "RELEASE_ANALYSIS" | "ACCEPT_RECORDING_LOSS" | "RECOVER_RECORDING";
      operationId: number;
    }>
  | Readonly<{ kind: "FINALIZE"; operationId: number }>
  | Readonly<{ kind: "CLEANUP"; operationId: number }>
  | Readonly<{ kind: "OBSERVE_RESOURCES"; attemptId: number }>
  | Readonly<{
      kind: "NOTIFY_COMPLETION";
      session: ContinuousPracticeSessionSnapshot;
    }>
  | Readonly<{
      kind: "RELEASE_COMPLETION";
      completion: ContinuousPracticeCompletion;
    }>
  | Readonly<{ kind: "SET_METRONOME"; enabled: boolean }>
  | Readonly<{
      kind: "PUBLISH_ANALYSIS";
      publication: ContinuousEvidencePublication;
    }>
  | Readonly<{ kind: "OBSERVE_MIDI"; attack: ContinuousMidiAttack }>;
export type ContinuousControlTransition = Readonly<{
  state: ContinuousControlState;
  effects: readonly ContinuousControlEffect[];
}>;
const resources = (): ContinuousResourceFacts => ({
  input: null,
  midi: "HEALTHY",
  recording: null,
  action: { kind: "NONE" },
});
export function initialContinuousControl(
  configuration: Configuration,
  metronomeEnabled: boolean,
): ContinuousControlState {
  return {
    tag: "IDLE",
    configuration,
    attemptId: 0,
    nextOperationId: 1,
    analysis: {
      kind: configuration.analysisRequired ? "PREPARING" : "NOT_REQUIRED",
    },
    resources: resources(),
    transport: null,
    pauseOwnership: "NONE",
    metronomeEnabled,
  };
}
function shared(state: ContinuousControlState): Shared {
  const {
    configuration,
    nextOperationId,
    attemptId,
    analysis,
    resources,
    pauseOwnership,
    transport,
    metronomeEnabled,
  } = state;
  return {
    configuration,
    nextOperationId,
    attemptId,
    analysis,
    resources,
    pauseOwnership,
    transport,
    metronomeEnabled,
  };
}
export function analysisControlError(
  state: ContinuousControlState,
): ContinuousErrorCode | null {
  return "code" in state.analysis ? state.analysis.code : null;
}
export function analysisAvailable(state: ContinuousControlState): boolean {
  return ["PREPARING", "ACTIVE", "DRAINING"].includes(state.analysis.kind);
}
export function resourceIntervention(
  state: ContinuousControlState,
): PracticeResourceIntervention | null {
  if (
    state.tag !== "ACTIVE" ||
    state.transport?.state !== "PAUSED" ||
    state.transportAction !== "NONE"
  )
    return null;
  const { input, midi, recording } = state.resources;
  if (!input && midi === "HEALTHY" && !recording) return null;
  const required = Boolean(input || midi !== "HEALTHY");
  const hard =
    input?.recoverability === "RESTART_REQUIRED" ||
    recording?.recoverability === "RESTART_REQUIRED";
  return {
    impact: required
      ? state.configuration.recording !== "OFF"
        ? "INPUT_AND_RECORDING"
        : "INPUT_REQUIRED"
      : "RECORDING_ONLY",
    reason:
      input?.reason ??
      (midi !== "HEALTHY" ? "NO_CONNECTED_INPUT" : recording!.reason),
    recoverability: hard ? "RESTART_REQUIRED" : "SAME_PIPELINE_RECOVERABLE",
    state:
      !hard &&
      (!input || input.healthy) &&
      midi !== "LOST" &&
      (!recording || recording.state === "RECOVERED_WAITING_FOR_USER")
        ? "RECOVERED_WAITING_FOR_USER"
        : "WAITING_FOR_USER",
    pauseOrigin: state.pauseOwnership === "USER" ? "USER" : "INTERVENTION",
  };
}
function blockers(state: ContinuousControlState): boolean {
  return (
    state.resources.action.kind !== "NONE" ||
    state.analysis.kind === "INTERRUPTED" ||
    Boolean(
      state.resources.input ||
        state.resources.recording ||
        state.resources.midi !== "HEALTHY",
    )
  );
}
function coordinate(
  state: ContinuousControlState,
  effects: ContinuousControlEffect[] = [],
): ContinuousControlTransition {
  if (
    state.tag !== "ACTIVE" ||
    state.transportAction !== "NONE" ||
    !state.transport
  )
    return { state, effects };
  const blocked = blockers(state);
  if (
    (blocked || state.pauseOwnership === "USER") &&
    state.transport.state !== "PAUSED" &&
    state.transport.state !== "ENDED"
  ) {
    const pauseOwnership =
      state.pauseOwnership === "NONE" ? "INTERVENTION" : state.pauseOwnership;
    return {
      state: { ...state, pauseOwnership, transportAction: "PAUSE" },
      effects: [
        ...effects,
        { kind: "PAUSE_TRANSPORT", attemptId: state.attemptId },
      ],
    };
  }
  if (
    !blocked &&
    state.pauseOwnership === "INTERVENTION" &&
    state.transport.state === "PAUSED"
  ) {
    return resume(state, effects);
  }
  return { state, effects };
}
function resume(
  state: Extract<ContinuousControlState, { tag: "ACTIVE" }>,
  effects: ContinuousControlEffect[] = [],
): ContinuousControlTransition {
  return {
    state: {
      ...state,
      pauseOwnership: "NONE",
      transportAction: "RESUME",
      recordingEntry:
        state.recordingEntry.kind === "INITIAL"
          ? state.recordingEntry
          : {
              kind: "RESUME",
              performanceTimeMs: state.transport!.performanceTimeMs,
            },
    },
    effects: [
      ...effects,
      { kind: "RESUME_TRANSPORT", attemptId: state.attemptId },
    ],
  };
}
function fail(
  state: ContinuousControlState,
  code: ContinuousErrorCode,
  cause?: unknown,
  analysisFailure = true,
): ContinuousControlTransition {
  const operationId = state.nextOperationId;
  const completion =
    state.tag === "COMPLETE"
      ? state.completion
      : state.tag === "FINALIZING" && state.workflow.stage === "CLEANUP"
        ? state.workflow.completion
        : null;
  return {
    state: {
      ...shared(state),
      nextOperationId: operationId + 1,
      tag: "FAILED",
      analysis:
        analysisFailure && state.configuration.analysisRequired
          ? { kind: "FAILED_FATAL", code }
          : state.analysis,
      failure: {
        origin:
          state.tag === "PREPARING" ||
          (state.tag === "ACTIVE" && state.transportAction === "START")
            ? "PREPARATION"
            : "ACTIVE",
        code,
        cause,
      },
      release: { kind: "RELEASING", operationId },
    },
    effects: [
      ...(completion
        ? [{ kind: "RELEASE_COMPLETION" as const, completion }]
        : []),
      { kind: "CLEANUP", operationId },
    ],
  };
}
function terminal(
  state: ContinuousControlState,
  transport: Readonly<PerformanceClockSnapshot>,
): ContinuousControlTransition {
  const operationId = state.nextOperationId,
    error = analysisControlError(state);
  return {
    state: {
      ...shared(state),
      tag: "FINALIZING",
      transport,
      nextOperationId: operationId + 1,
      operationId,
      analysis: !state.configuration.analysisRequired
        ? { kind: "NOT_REQUIRED" }
        : error
          ? { kind: "UNAVAILABLE_AFTER_TERMINAL", code: error }
          : { kind: "DRAINING" },
      workflow: { stage: "DRAINING" },
    },
    effects: [{ kind: "FINALIZE", operationId }],
  };
}
/** Browser-free coordination. Leaf owners provide observations; only effects mutate them. */
export function transitionContinuousControl(
  state: ContinuousControlState,
  event: ContinuousControlEvent,
): ContinuousControlTransition {
  const unchanged = { state, effects: [] } as const;
  if ("attemptId" in event && event.attemptId !== state.attemptId)
    return unchanged;
  if (
    event.type === "FINALIZED" &&
    ((state.tag === "COMPLETE" && state.completion === event.completion) ||
      (state.tag === "FINALIZING" &&
        state.workflow.stage === "CLEANUP" &&
        state.workflow.completion === event.completion))
  )
    return unchanged;
  if (
    event.type === "FINALIZED" &&
    !(
      state.tag === "FINALIZING" &&
      state.operationId === event.operationId &&
      state.workflow.stage === "DRAINING"
    )
  )
    return {
      state,
      effects: [{ kind: "RELEASE_COMPLETION", completion: event.completion }],
    };
  if (event.type === "CLEANUP_FINISHED") {
    const id =
      state.tag === "FINALIZING" && state.workflow.stage === "CLEANUP"
        ? state.operationId
        : (state.tag === "FAILED" ||
              state.tag === "ABANDONED" ||
              state.tag === "DISPOSED") &&
            state.release.kind === "RELEASING"
          ? state.release.operationId
          : null;
    if (id !== event.operationId) return unchanged;
    if ("failure" in event) {
      const completion =
        state.tag === "FINALIZING" && state.workflow.stage === "CLEANUP"
          ? state.workflow.completion
          : null;
      return {
        state: {
          ...shared(state),
          tag: "FAILED",
          failure: {
            origin: "CLEANUP",
            code: "RESOURCE_CLEANUP_FAILED",
            cause: event.failure,
          },
          release: completion
            ? { kind: "RELEASING", operationId: state.nextOperationId }
            : { kind: "RELEASED" },
          nextOperationId: state.nextOperationId + (completion ? 1 : 0),
        },
        effects: completion
          ? [
              { kind: "RELEASE_COMPLETION", completion },
              { kind: "CLEANUP", operationId: state.nextOperationId },
            ]
          : [],
      };
    }
    if (state.tag === "FINALIZING" && state.workflow.stage === "CLEANUP") {
      return {
        state: {
          ...shared(state),
          tag: "COMPLETE",
          completion: state.workflow.completion,
          session: state.workflow.session,
          analysis:
            state.analysis.kind === "DRAINING"
              ? { kind: "COMPLETE" }
              : state.analysis,
        },
        effects: [
          { kind: "NOTIFY_COMPLETION", session: state.workflow.session },
        ],
      };
    }
    if (
      state.tag === "ABANDONED" ||
      state.tag === "DISPOSED" ||
      state.tag === "FAILED"
    )
      return {
        state: { ...state, release: { kind: "RELEASED" } },
        effects: [],
      };
    return unchanged;
  }
  if (event.type === "DISPOSE_REQUESTED") {
    if (state.tag === "DISPOSED") return unchanged;
    const operationId = state.nextOperationId;
    const completion =
      state.tag === "COMPLETE"
        ? state.completion
        : state.tag === "FINALIZING" && state.workflow.stage === "CLEANUP"
          ? state.workflow.completion
          : null;
    return {
      state: {
        ...shared(state),
        tag: "DISPOSED",
        nextOperationId: operationId + 1,
        release: { kind: "RELEASING", operationId },
      },
      effects: [
        ...(completion
          ? [{ kind: "RELEASE_COMPLETION" as const, completion }]
          : []),
        { kind: "CLEANUP", operationId },
      ],
    };
  }
  if (
    state.tag === "DISPOSED" ||
    state.tag === "ABANDONED" ||
    state.tag === "FAILED" ||
    state.tag === "COMPLETE"
  )
    return unchanged;
  switch (event.type) {
    case "START_REQUESTED": {
      if (state.tag !== "IDLE") return unchanged;
      const operationId = state.nextOperationId;
      return {
        state: {
          ...shared(state),
          tag: "PREPARING",
          attemptId: operationId,
          operationId,
          nextOperationId: operationId + 1,
        },
        effects: [{ kind: "PREPARE", operationId }],
      };
    }
    case "PREPARED":
      if (state.tag !== "PREPARING" || state.operationId !== event.operationId)
        return unchanged;
      return {
        state: {
          ...shared(state),
          tag: "ACTIVE",
          transportAction: "START",
          recordingEntry: { kind: "INITIAL" },
          analysis: state.configuration.analysisRequired
            ? { kind: "ACTIVE" }
            : { kind: "NOT_REQUIRED" },
        },
        effects: [{ kind: "START_TRANSPORT", attemptId: state.attemptId }],
      };
    case "PREPARATION_FAILED":
      return state.tag === "PREPARING" &&
        state.operationId === event.operationId
        ? fail(state, event.code, event.cause, event.analysisFailure)
        : unchanged;
    case "FATAL_FAILED":
      return fail(
        state,
        event.code,
        event.cause,
        !(
          state.tag === "ACTIVE" &&
          state.transportAction === "START" &&
          event.code === "RECORDING_PREPARATION_FAILED"
        ),
      );
    case "ANALYSIS_RELEASE_FAILED":
      return state.tag === "ACTIVE" &&
        state.analysis.kind === "INTERRUPTED" &&
        state.analysis.release.operationId === event.operationId
        ? fail(state, event.code, event.cause)
        : unchanged;
    case "RESOURCE_ACTION_FAILED":
      return state.tag === "ACTIVE" &&
        state.resources.action.kind !== "NONE" &&
        state.resources.action.operationId === event.operationId
        ? fail(state, event.code, event.cause)
        : unchanged;
    case "FINALIZATION_FAILED":
      return state.tag === "FINALIZING" &&
        state.operationId === event.operationId &&
        state.workflow.stage === "DRAINING"
        ? fail(state, event.code, event.cause)
        : unchanged;
    case "TRANSPORT_OBSERVED": {
      if (event.action === "ABANDON") return unchanged;
      if (state.tag !== "ACTIVE") return unchanged;
      if (event.transport.completionReason === "SCOPE_COMPLETED")
        return terminal(state, event.transport);
      let current: Extract<ContinuousControlState, { tag: "ACTIVE" }> = {
        ...state,
        transport: event.transport,
        transportAction:
          event.action === "EVIDENCE" ? state.transportAction : "NONE",
      };
      const effects: ContinuousControlEffect[] = [];
      if (event.action === "PAUSE" && current.recordingEntry.kind === "RESUME")
        current = { ...current, recordingEntry: { kind: "SETTLED" } };
      if (
        event.transport.state === "RUNNING" &&
        current.recordingEntry.kind !== "SETTLED"
      ) {
        effects.push({
          kind:
            current.recordingEntry.kind === "INITIAL"
              ? "START_RECORDING"
              : "RESUME_RECORDING",
          performanceTimeMs:
            current.recordingEntry.kind === "RESUME"
              ? current.recordingEntry.performanceTimeMs
              : event.transport.performanceTimeMs,
        });
        current = { ...current, recordingEntry: { kind: "SETTLED" } };
      }
      return coordinate(current, effects);
    }
    case "PAUSE_REQUESTED":
      if (state.tag !== "ACTIVE") return unchanged;
      return coordinate({ ...state, pauseOwnership: "USER" });
    case "RESUME_REQUESTED":
      return state.tag === "ACTIVE" &&
        state.transportAction === "NONE" &&
        state.transport?.state === "PAUSED" &&
        !blockers(state)
        ? resume(state)
        : unchanged;
    case "REFRESH_REQUESTED":
      return state.tag === "ACTIVE" && state.transportAction === "NONE"
        ? {
            state: { ...state, transportAction: "REFRESH" },
            effects: [
              { kind: "REFRESH_TRANSPORT", attemptId: state.attemptId },
            ],
          }
        : unchanged;
    case "ABANDON_REQUESTED": {
      if (state.tag !== "ACTIVE" && state.tag !== "PREPARING") return unchanged;
      const operationId = state.nextOperationId;
      return {
        state: {
          ...shared(state),
          tag: "ABANDONED",
          transport: null,
          nextOperationId: operationId + 1,
          release: { kind: "RELEASING", operationId },
        },
        effects: [
          { kind: "ABANDON_TRANSPORT", attemptId: state.attemptId },
          { kind: "CLEANUP", operationId },
        ],
      };
    }
    case "ROOTS_CHANGED":
      return {
        state,
        effects: [{ kind: "OBSERVE_RESOURCES", attemptId: state.attemptId }],
      };
    case "RESOURCE_FACTS_OBSERVED": {
      const midi = event.midiHealthy
        ? state.resources.midi === "LOST"
          ? "RECOVERED"
          : state.resources.midi
        : "LOST";
      return coordinate({
        ...state,
        resources: {
          ...state.resources,
          midi,
          recording:
            state.resources.action.kind === "ACCEPT_RECORDING"
              ? state.resources.recording
              : event.recording,
        },
      });
    }
    case "INPUT_HEALTH_OBSERVED": {
      if (state.tag === "FINALIZING" && state.workflow.stage === "CLEANUP")
        return unchanged;
      if (state.tag === "PREPARING" || state.tag === "FINALIZING")
        return !event.health.healthy
          ? fail(
              state,
              event.health.reason === "CAPTURE_PIPELINE_INVALID"
                ? "ANALYSIS_FAILED"
                : event.health.reason,
            )
          : unchanged;
      if (state.tag !== "ACTIVE") return unchanged;
      const prior = state.resources.input;
      const input =
        prior?.recoverability === "RESTART_REQUIRED"
          ? { ...prior, healthy: false }
          : event.health.healthy
            ? prior
              ? { ...event.health, reason: prior.reason }
              : null
            : event.health;
      return coordinate({ ...state, resources: { ...state.resources, input } });
    }
    case "ANALYSIS_FAILED": {
      if (state.tag === "FINALIZING" && state.workflow.stage === "CLEANUP")
        return unchanged;
      if (!analysisAvailable(state)) return unchanged;
      if (state.tag === "PREPARING") return fail(state, event.code);
      const operationId = state.nextOperationId;
      if (state.tag === "FINALIZING")
        return {
          state: {
            ...state,
            analysis: { kind: "UNAVAILABLE_AFTER_TERMINAL", code: event.code },
            nextOperationId: operationId + 1,
          },
          effects: [{ kind: "RELEASE_ANALYSIS", operationId }],
        };
      if (state.tag !== "ACTIVE") return unchanged;
      return coordinate(
        {
          ...state,
          nextOperationId: operationId + 1,
          analysis: {
            kind: "INTERRUPTED",
            code: event.code,
            release: { operationId, status: "PENDING" },
            choice: "WAITING",
          },
          resources: {
            ...state.resources,
            input:
              state.resources.input?.reason === "MICROPHONE_SOURCE_LOST"
                ? null
                : state.resources.input,
          },
        },
        [{ kind: "RELEASE_ANALYSIS", operationId }],
      );
    }
    case "CONTINUE_ANALYSIS_REQUESTED": {
      if (state.tag !== "ACTIVE" || state.analysis.kind !== "INTERRUPTED")
        return unchanged;
      if (state.analysis.release.status === "RELEASED")
        return coordinate({
          ...state,
          analysis: { kind: "DISABLED", code: state.analysis.code },
        });
      return {
        state: {
          ...state,
          analysis: { ...state.analysis, choice: "CONTINUE" },
        },
        effects: [],
      };
    }
    case "ANALYSIS_RELEASED": {
      if (
        state.tag !== "ACTIVE" ||
        state.analysis.kind !== "INTERRUPTED" ||
        state.analysis.release.operationId !== event.operationId
      )
        return unchanged;
      return state.analysis.choice === "CONTINUE"
        ? coordinate({
            ...state,
            analysis: { kind: "DISABLED", code: state.analysis.code },
          })
        : {
            state: {
              ...state,
              analysis: {
                ...state.analysis,
                release: { ...state.analysis.release, status: "RELEASED" },
              },
            },
            effects: [],
          };
    }
    case "CONTINUE_RECORDING_REQUESTED": {
      const incident = resourceIntervention(state);
      if (
        state.tag !== "ACTIVE" ||
        state.analysis.kind === "INTERRUPTED" ||
        incident?.impact !== "RECORDING_ONLY" ||
        incident.state !== "WAITING_FOR_USER" ||
        state.resources.action.kind !== "NONE" ||
        (state.resources.input && !state.resources.input.healthy) ||
        state.resources.midi === "LOST"
      )
        return unchanged;
      const operationId = state.nextOperationId;
      return {
        state: {
          ...state,
          nextOperationId: operationId + 1,
          resources: {
            ...state.resources,
            action: { kind: "ACCEPT_RECORDING", operationId },
          },
        },
        effects: [{ kind: "ACCEPT_RECORDING_LOSS", operationId }],
      };
    }
    case "RECOVERY_REQUESTED": {
      if (
        state.tag !== "ACTIVE" ||
        resourceIntervention(state)?.state !== "RECOVERED_WAITING_FOR_USER" ||
        state.resources.action.kind !== "NONE"
      )
        return unchanged;
      const operationId = state.nextOperationId;
      return {
        state: {
          ...state,
          nextOperationId: operationId + 1,
          resources: {
            ...state.resources,
            action: { kind: "RECOVER", operationId },
          },
        },
        effects: [{ kind: "RECOVER_RECORDING", operationId }],
      };
    }
    case "RESOURCE_ACTION_FINISHED": {
      if (
        state.tag !== "ACTIVE" ||
        state.resources.action.kind === "NONE" ||
        state.resources.action.operationId !== event.operationId
      )
        return unchanged;
      return coordinate({
        ...state,
        resources: {
          ...state.resources,
          input:
            event.success &&
            state.resources.action.kind === "RECOVER" &&
            state.resources.input?.healthy
              ? null
              : state.resources.input,
          midi:
            event.success &&
            state.resources.action.kind === "RECOVER" &&
            state.resources.midi === "RECOVERED"
              ? "HEALTHY"
              : state.resources.midi,
          recording:
            event.success && state.resources.action.kind === "ACCEPT_RECORDING"
              ? null
              : event.recording,
          action: { kind: "NONE" },
        },
      });
    }
    case "FINALIZED":
      if (state.tag !== "FINALIZING") return unchanged;
      return {
        state: {
          ...state,
          workflow: {
            stage: "CLEANUP",
            completion: event.completion,
            session: event.session,
          },
        },
        effects: [{ kind: "CLEANUP", operationId: state.operationId }],
      };
    case "METRONOME_REQUESTED":
      return {
        state: { ...state, metronomeEnabled: event.enabled },
        effects: [{ kind: "SET_METRONOME", enabled: event.enabled }],
      };
    case "ANALYSIS_PUBLICATION":
      return state.tag === "ACTIVE" || state.tag === "FINALIZING"
        ? analysisAvailable(state)
          ? {
              state,
              effects: [
                { kind: "PUBLISH_ANALYSIS", publication: event.publication },
              ],
            }
          : unchanged
        : unchanged;
    case "MIDI_ATTACK":
      return state.tag === "ACTIVE"
        ? { state, effects: [{ kind: "OBSERVE_MIDI", attack: event.attack }] }
        : unchanged;
  }
}
