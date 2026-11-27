// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  initialContinuousControl,
  transitionContinuousControl,
  resourceIntervention,
  analysisControlError,
  type ContinuousControlState,
  type ContinuousControlEvent,
} from "./continuous-control-machine";
import type { PerformanceClockSnapshot } from "./domain/performance-clock";
import type { RecordingRuntimeInterruption } from "../recording/recording-runtime-fault";
import { canonicalContinuousResultFixture } from "../__fixtures__/continuous-result";
import { continuousPracticePlan } from "../__fixtures__/practice-plan";
import artifact from "../__fixtures__/canonical-practice-score-artifact.json";
import type { PracticeScoreArtifact } from "../score/artifact";
import { ContinuousPracticeSession } from "./domain/practice-session";
import { ManualClock } from "../session/timebase";
import type { ContinuousPracticeCompletion } from "./completion";

const next = (state: ContinuousControlState, event: ContinuousControlEvent) =>
  transitionContinuousControl(state, event).state;
const initial = (analysisRequired = true) =>
  initialContinuousControl(
    {
      analysisRequired,
      input: analysisRequired ? "MICROPHONE" : "MIDI",
      recording: "AUDIO",
    },
    false,
  );
const preparing = (analysisRequired = true) =>
  next(initial(analysisRequired), { type: "START_REQUESTED" });
function transport(
  fields: Partial<PerformanceClockSnapshot> = {},
): PerformanceClockSnapshot {
  return {
    state: "RUNNING",
    countInKind: null,
    nowMs: 500,
    scoreTick: 1,
    timelineTimeMs: 500,
    performanceTimeMs: 500,
    countInTotalMs: 0,
    countInRemainingMs: 0,
    countInTicks: 0,
    countInPulses: 0,
    countInPulse: 0,
    scopeCompleted: false,
    scopeStartTick: 0,
    scopeTerminalTick: 10,
    completionReason: null,
    ...fields,
  };
}
function observe(
  state: ContinuousControlState,
  fields: Partial<PerformanceClockSnapshot> = {},
  action: Extract<
    ContinuousControlEvent,
    { type: "TRANSPORT_OBSERVED" }
  >["action"] = "REFRESH",
) {
  return next(state, {
    type: "TRANSPORT_OBSERVED",
    attemptId: state.attemptId,
    action,
    transport: transport(fields),
  });
}
function active(analysisRequired = true) {
  const state = preparing(analysisRequired);
  return observe(
    next(state, { type: "PREPARED", operationId: state.attemptId }),
    {},
    "START",
  );
}
const fault: RecordingRuntimeInterruption = {
  reason: "AUDIO_TRACK_MUTED",
  recoverability: "SAME_PIPELINE_RECOVERABLE",
  state: "WAITING_FOR_USER",
};
const analysisFault = (state: ContinuousControlState) =>
  next(state, {
    type: "ANALYSIS_FAILED",
    attemptId: state.attemptId,
    code: "ANALYSIS_FAILED",
  });
const recordingFault = (
  state: ContinuousControlState,
  recording: RecordingRuntimeInterruption | null = fault,
) =>
  next(state, {
    type: "RESOURCE_FACTS_OBSERVED",
    attemptId: state.attemptId,
    midiHealthy: true,
    recording,
  });
function disableAnalysis(state: ContinuousControlState) {
  if (state.analysis.kind !== "INTERRUPTED")
    throw new Error("Expected analysis interruption");
  const operationId = state.analysis.release.operationId;
  return next(next(state, { type: "CONTINUE_ANALYSIS_REQUESTED" }), {
    type: "ANALYSIS_RELEASED",
    operationId,
  });
}
function terminal(state = active()) {
  return observe(state, {
    state: "ENDED",
    completionReason: "SCOPE_COMPLETED",
    scopeCompleted: true,
  });
}
function payload() {
  const plan = continuousPracticePlan(artifact as PracticeScoreArtifact, {
    inputSource: "MICROPHONE",
  });
  const session = new ContinuousPracticeSession({
    plan,
    clock: new ManualClock(0),
    metadataClock: { nowEpochMs: () => 0 },
    localSessionId: "control-test",
  }).snapshotSession();
  const completion: ContinuousPracticeCompletion = {
    result: canonicalContinuousResultFixture(),
    recording: { status: "NOT_RECORDED" },
  };
  return { session, completion };
}

describe("Continuous control machine", () => {
  it("prepares once and starts canonical transport only after required resources are prepared", () => {
    const first = transitionContinuousControl(initial(), {
      type: "START_REQUESTED",
    });
    expect(first.state.tag).toBe("PREPARING");
    expect(first.effects).toEqual([{ kind: "PREPARE", operationId: 1 }]);
    expect(
      transitionContinuousControl(first.state, { type: "START_REQUESTED" }),
    ).toEqual({ state: first.state, effects: [] });
    const ready = transitionContinuousControl(first.state, {
      type: "PREPARED",
      operationId: 1,
    });
    expect(ready.state.tag).toBe("ACTIVE");
    expect(ready.effects).toEqual([{ kind: "START_TRANSPORT", attemptId: 1 }]);
  });
  it("preparation failure owns one cleanup and never starts transport or completion", () => {
    const failed = transitionContinuousControl(preparing(), {
      type: "PREPARATION_FAILED",
      operationId: 1,
      code: "MODEL_LOAD_FAILED",
      analysisFailure: true,
    });
    expect(failed.state).toMatchObject({
      tag: "FAILED",
      failure: { origin: "PREPARATION", code: "MODEL_LOAD_FAILED" },
      release: { kind: "RELEASING" },
    });
    expect(failed.effects).toEqual([{ kind: "CLEANUP", operationId: 2 }]);
  });
  it("user pause remains user-owned through a fault and its recovery", () => {
    const requested = transitionContinuousControl(active(), {
      type: "PAUSE_REQUESTED",
    });
    expect(requested.effects).toEqual([
      { kind: "PAUSE_TRANSPORT", attemptId: 1 },
    ]);
    let state = observe(requested.state, { state: "PAUSED" }, "PAUSE");
    state = observe(analysisFault(state), { state: "PAUSED" }, "PAUSE");
    const cleared = disableAnalysis(state);
    expect(cleared.pauseOwnership).toBe("USER");
    expect(cleared.transport?.state).toBe("PAUSED");
    expect(
      transitionContinuousControl(cleared, { type: "REFRESH_REQUESTED" })
        .effects,
    ).toEqual([{ kind: "REFRESH_TRANSPORT", attemptId: 1 }]);
  });
  it.each(["analysis", "recording"] as const)(
    "%s failure requests one intervention-owned pause",
    (incident) => {
      const state = active();
      const event: ContinuousControlEvent =
        incident === "analysis"
          ? { type: "ANALYSIS_FAILED", attemptId: 1, code: "ANALYSIS_FAILED" }
          : {
              type: "RESOURCE_FACTS_OBSERVED",
              attemptId: 1,
              midiHealthy: true,
              recording: fault,
            };
      const first = transitionContinuousControl(state, event);
      expect(first.state.pauseOwnership).toBe("INTERVENTION");
      expect(
        first.effects.filter((effect) => effect.kind === "PAUSE_TRANSPORT"),
      ).toHaveLength(1);
      expect(transitionContinuousControl(first.state, event).effects).toEqual(
        [],
      );
    },
  );
  it.each(["analysis", "recording"] as const)(
    "dual faults (%s first) own one pause and both interventions",
    (first) => {
      let state = active();
      const events: ContinuousControlEvent[] = [
        { type: "ANALYSIS_FAILED", attemptId: 1, code: "ANALYSIS_FAILED" },
        {
          type: "RESOURCE_FACTS_OBSERVED",
          attemptId: 1,
          midiHealthy: true,
          recording: fault,
        },
      ];
      if (first === "recording") events.reverse();
      const effects = events.flatMap((event) => {
        const result = transitionContinuousControl(state, event);
        state = result.state;
        return result.effects;
      });
      expect(
        effects.filter((effect) => effect.kind === "PAUSE_TRANSPORT"),
      ).toHaveLength(1);
      state = observe(state, { state: "PAUSED" }, "PAUSE");
      expect(state.analysis.kind).toBe("INTERRUPTED");
      expect(resourceIntervention(state)).toMatchObject({
        impact: "RECORDING_ONLY",
        pauseOrigin: "INTERVENTION",
      });
      state = disableAnalysis(state);
      expect(state).toMatchObject({
        tag: "ACTIVE",
        transportAction: "NONE",
        analysis: { kind: "DISABLED" },
      });
      expect(state.transport?.state).toBe("PAUSED");
      const accepted = transitionContinuousControl(state, {
        type: "CONTINUE_RECORDING_REQUESTED",
      });
      expect(accepted.effects[0].kind).toBe("ACCEPT_RECORDING_LOSS");
      const operationId =
        accepted.state.resources.action.kind !== "NONE"
          ? accepted.state.resources.action.operationId
          : 0;
      // Fault disappearing while asynchronous retirement runs grants no resume permission.
      state = recordingFault(accepted.state, null);
      expect(state).toMatchObject({ transportAction: "NONE" });
      const retired = transitionContinuousControl(state, {
        type: "RESOURCE_ACTION_FINISHED",
        operationId,
        success: true,
        recording: null,
      });
      expect(retired.effects).toEqual([
        { kind: "RESUME_TRANSPORT", attemptId: 1 },
      ]);
    },
  );
  it("resource recovery cannot resume while analysis intervention remains", () => {
    let state = observe(
      recordingFault(analysisFault(active())),
      { state: "PAUSED" },
      "PAUSE",
    );
    state = recordingFault(state, {
      ...fault,
      state: "RECOVERED_WAITING_FOR_USER",
    });
    const recovery = transitionContinuousControl(state, {
      type: "RECOVERY_REQUESTED",
    });
    const action = recovery.state.resources.action;
    if (action.kind === "NONE") throw new Error("Expected recovery");
    const recovered = transitionContinuousControl(recovery.state, {
      type: "RESOURCE_ACTION_FINISHED",
      operationId: action.operationId,
      success: true,
      recording: null,
    });
    expect(recovered.effects).toEqual([]);
    expect(recovered.state.analysis.kind).toBe("INTERRUPTED");
    expect(recovered.state.transport?.state).toBe("PAUSED");
    expect(disableAnalysis(recovered.state)).toMatchObject({
      transportAction: "RESUME",
    });
  });
  it("asynchronous recording retirement cannot erase a newer required-input fault", () => {
    const interrupted = observe(
      recordingFault(active()),
      { state: "PAUSED" },
      "PAUSE",
    );
    let state = next(interrupted, { type: "CONTINUE_RECORDING_REQUESTED" });
    const action = state.resources.action;
    if (action.kind !== "ACCEPT_RECORDING")
      throw new Error("Expected retirement");
    state = next(state, {
      type: "INPUT_HEALTH_OBSERVED",
      attemptId: 1,
      health: {
        healthy: false,
        reason: "MICROPHONE_SOURCE_LOST",
        recoverability: "RESTART_REQUIRED",
      },
    });
    const retired = transitionContinuousControl(state, {
      type: "RESOURCE_ACTION_FINISHED",
      operationId: action.operationId,
      success: true,
      recording: null,
    });
    expect(retired.effects).toEqual([]);
    expect(retired.state.transport?.state).toBe("PAUSED");
    expect(resourceIntervention(retired.state)).toMatchObject({
      reason: "MICROPHONE_SOURCE_LOST",
      recoverability: "RESTART_REQUIRED",
    });
  });
  it("Continue without analysis waits the same release and permanently disables publications", () => {
    let state = observe(analysisFault(active()), { state: "PAUSED" }, "PAUSE");
    if (state.analysis.kind !== "INTERRUPTED")
      throw new Error("Expected interruption");
    const operationId = state.analysis.release.operationId;
    state = next(state, { type: "CONTINUE_ANALYSIS_REQUESTED" });
    expect(state.analysis.kind).toBe("INTERRUPTED");
    expect(
      transitionContinuousControl(state, {
        type: "CONTINUE_ANALYSIS_REQUESTED",
      }).effects,
    ).toEqual([]);
    state = next(state, { type: "ANALYSIS_RELEASED", operationId });
    expect(state.analysis.kind).toBe("DISABLED");
    expect(analysisControlError(state)).toBe("ANALYSIS_FAILED");
    expect(analysisFault(state)).toBe(state);
    expect(
      transitionContinuousControl(state, {
        type: "ANALYSIS_RELEASE_FAILED",
        operationId,
        code: "RESOURCE_CLEANUP_FAILED",
      }).state,
    ).toBe(state);
  });
  it("resume countdown emits one recorder resume at the frozen performance position", () => {
    let state = observe(
      next(active(), { type: "PAUSE_REQUESTED" }),
      { state: "PAUSED", performanceTimeMs: 113 },
      "PAUSE",
    );
    state = next(state, { type: "RESUME_REQUESTED" });
    const countdown = transitionContinuousControl(state, {
      type: "TRANSPORT_OBSERVED",
      attemptId: 1,
      action: "RESUME",
      transport: transport({
        state: "COUNT_IN",
        countInKind: "RESUME",
        performanceTimeMs: 113,
      }),
    });
    expect(countdown.effects).toEqual([]);
    const running = transitionContinuousControl(countdown.state, {
      type: "TRANSPORT_OBSERVED",
      attemptId: 1,
      action: "REFRESH",
      transport: transport({ performanceTimeMs: 120 }),
    });
    expect(running.effects).toEqual([
      { kind: "RESUME_RECORDING", performanceTimeMs: 113 },
    ]);
    expect(
      transitionContinuousControl(running.state, {
        type: "TRANSPORT_OBSERVED",
        attemptId: 1,
        action: "REFRESH",
        transport: transport(),
      }).effects,
    ).toEqual([]);
  });
  it("pausing a resume countdown invalidates that recorder handoff", () => {
    let state = observe(
      next(active(), { type: "PAUSE_REQUESTED" }),
      { state: "PAUSED" },
      "PAUSE",
    );
    state = observe(
      next(state, { type: "RESUME_REQUESTED" }),
      { state: "COUNT_IN", countInKind: "RESUME" },
      "RESUME",
    );
    state = observe(
      next(state, { type: "PAUSE_REQUESTED" }),
      { state: "PAUSED" },
      "PAUSE",
    );
    expect(state).toMatchObject({ recordingEntry: { kind: "SETTLED" } });
  });
  it("formal terminal latch wins later End and analysis failure produces no learner dialog", () => {
    let state = terminal();
    expect(state.tag).toBe("FINALIZING");
    expect(next(state, { type: "ABANDON_REQUESTED" })).toBe(state);
    const failure = transitionContinuousControl(state, {
      type: "ANALYSIS_FAILED",
      attemptId: 1,
      code: "ANALYSIS_FAILED",
    });
    state = failure.state;
    expect(state).toMatchObject({
      tag: "FINALIZING",
      analysis: { kind: "UNAVAILABLE_AFTER_TERMINAL" },
    });
    expect(resourceIntervention(state)).toBeNull();
    expect(failure.effects.map((effect) => effect.kind)).toEqual([
      "RELEASE_ANALYSIS",
    ]);
  });
  it("End before formal terminal event wins and fences all stale semantic work", () => {
    const abandoned = next(active(), { type: "ABANDON_REQUESTED" });
    expect(abandoned.tag).toBe("ABANDONED");
    expect(terminal(abandoned)).toBe(abandoned);
    expect(
      next(abandoned, {
        type: "ANALYSIS_FAILED",
        attemptId: 1,
        code: "ANALYSIS_FAILED",
      }),
    ).toBe(abandoned);
    expect(next(abandoned, { type: "REFRESH_REQUESTED" })).toBe(abandoned);
  });
  it.each(["ABANDON_REQUESTED", "DISPOSE_REQUESTED"] as const)(
    "%s fences old preparation and asynchronous operation results",
    (type) => {
      const state = next(preparing(), { type });
      for (const event of [
        { type: "PREPARED", operationId: 1 },
        {
          type: "PREPARATION_FAILED",
          operationId: 1,
          code: "MODEL_LOAD_FAILED",
          analysisFailure: true,
        },
        { type: "ANALYSIS_RELEASED", operationId: 1 },
        {
          type: "ANALYSIS_RELEASE_FAILED",
          operationId: 1,
          code: "RESOURCE_CLEANUP_FAILED",
        },
        {
          type: "RESOURCE_ACTION_FAILED",
          operationId: 1,
          code: "RESOURCE_CLEANUP_FAILED",
        },
        {
          type: "FINALIZATION_FAILED",
          operationId: 1,
          code: "RECORDER_UNAVAILABLE",
        },
        { type: "FATAL_FAILED", attemptId: 1, code: "ANALYSIS_FAILED" },
        { type: "CLEANUP_FINISHED", operationId: 1 },
      ] satisfies ContinuousControlEvent[])
        expect(transitionContinuousControl(state, event)).toEqual({
          state,
          effects: [],
        });
    },
  );
  it("stale attempt facts cannot alter current analysis, transport, or resource truth", () => {
    const state = active();
    expect(
      next(state, {
        type: "ANALYSIS_FAILED",
        attemptId: 0,
        code: "ANALYSIS_FAILED",
      }),
    ).toBe(state);
    expect(
      next(state, {
        type: "RESOURCE_FACTS_OBSERVED",
        attemptId: 0,
        midiHealthy: false,
        recording: fault,
      }),
    ).toBe(state);
    expect(
      next(state, {
        type: "TRANSPORT_OBSERVED",
        attemptId: 0,
        action: "REFRESH",
        transport: transport({
          state: "ENDED",
          completionReason: "SCOPE_COMPLETED",
        }),
      }),
    ).toBe(state);
  });
  it("finalization publishes one atomic completion only after resource cleanup", () => {
    const finalizing = terminal();
    if (finalizing.tag !== "FINALIZING")
      throw new Error("Expected finalization");
    const data = payload(),
      event = {
        type: "FINALIZED",
        operationId: finalizing.operationId,
        ...data,
      } as const;
    const materialized = transitionContinuousControl(finalizing, event);
    expect(materialized.state.tag).toBe("FINALIZING");
    expect(materialized.effects).toEqual([
      { kind: "CLEANUP", operationId: finalizing.operationId },
    ]);
    expect(
      transitionContinuousControl(materialized.state, event).effects,
    ).toEqual([]);
    expect(analysisFault(materialized.state)).toBe(materialized.state);
    expect(
      next(materialized.state, {
        type: "INPUT_HEALTH_OBSERVED",
        attemptId: 1,
        health: {
          healthy: false,
          reason: "MICROPHONE_SOURCE_LOST",
          recoverability: "RESTART_REQUIRED",
        },
      }),
    ).toBe(materialized.state);
    const complete = transitionContinuousControl(materialized.state, {
      type: "CLEANUP_FINISHED",
      operationId: finalizing.operationId,
    });
    expect(complete.state).toMatchObject({
      tag: "COMPLETE",
      completion: data.completion,
      session: data.session,
    });
    expect(complete.effects).toEqual([
      { kind: "NOTIFY_COMPLETION", session: data.session },
    ]);
    expect(transitionContinuousControl(complete.state, event).effects).toEqual(
      [],
    );
    expect(
      transitionContinuousControl(complete.state, {
        type: "CLEANUP_FINISHED",
        operationId: finalizing.operationId,
      }).effects,
    ).toEqual([]);
  });
  it("cleanup failure has one stable terminal error and releases unpublished completion", () => {
    const state = terminal();
    if (state.tag !== "FINALIZING") throw new Error("Expected finalization");
    const materialized = next(state, {
      type: "FINALIZED",
      operationId: state.operationId,
      ...payload(),
    });
    const failure = transitionContinuousControl(materialized, {
      type: "CLEANUP_FINISHED",
      operationId: state.operationId,
      failure: new Error("private diagnostic"),
    });
    expect(failure.state).toMatchObject({
      tag: "FAILED",
      failure: { origin: "CLEANUP", code: "RESOURCE_CLEANUP_FAILED" },
      release: { kind: "RELEASING" },
    });
    expect(failure.effects.map((effect) => effect.kind)).toEqual([
      "RELEASE_COMPLETION",
      "CLEANUP",
    ]);
    const cleanup = failure.effects.find(
      (effect) => effect.kind === "CLEANUP",
    )!;
    const failed = next(failure.state, {
      type: "CLEANUP_FINISHED",
      operationId: cleanup.operationId,
      failure: new Error("same failure"),
    });
    expect(failed).toMatchObject({
      tag: "FAILED",
      release: { kind: "RELEASED" },
    });
    expect(next(failed, { type: "START_REQUESTED" })).toBe(failed);
  });
  it("disposing during finalization rejects late materialization and releases its media", () => {
    const finalizing = terminal();
    if (finalizing.tag !== "FINALIZING")
      throw new Error("Expected finalization");
    const disposed = next(finalizing, { type: "DISPOSE_REQUESTED" });
    const data = payload();
    const late = transitionContinuousControl(disposed, {
      type: "FINALIZED",
      operationId: finalizing.operationId,
      ...data,
    });
    expect(late.state).toBe(disposed);
    expect(late.effects).toEqual([
      { kind: "RELEASE_COMPLETION", completion: data.completion },
    ]);
    expect(next(disposed, { type: "DISPOSE_REQUESTED" })).toBe(disposed);
  });
});
