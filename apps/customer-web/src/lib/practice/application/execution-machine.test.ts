import { describe, expect, it } from "vitest";
import {
  initialExecutionState,
  ownedExecution,
  transitionExecution,
  type PracticeExecutionActorState,
  type PracticeExecutionEvent,
} from "./execution-machine";
import { projectExecutionView } from "./execution-view";
import type {
  ExecutionCompletion,
  ExecutionObservation,
} from "./execution-observation";
import {
  stepPracticePlan,
  continuousPracticePlan,
} from "../__fixtures__/practice-plan";
import artifact from "../__fixtures__/canonical-practice-score-artifact.json";
import type { PracticeScoreArtifact } from "../score/artifact";
import { canonicalContinuousResultFixture } from "../__fixtures__/continuous-result";

const plan = stepPracticePlan(artifact as PracticeScoreArtifact);
const stepObservation: ExecutionObservation = {
  mode: "STEP_BY_STEP",
  error: null,
  activeStepGroup: null,
  stepInteractionPhase: "READY",
  pendingPostVerdict: null,
  canAcceptAttempt: true,
  analysisIntervention: null,
  infrastructureIntervention: null,
};
const session = { completionReason: "SCOPE_COMPLETED" } as ExecutionCompletion;
const next = (
  state: PracticeExecutionActorState,
  event: PracticeExecutionEvent,
) => transitionExecution(state, event).state;
const candidate = (
  state = initialExecutionState(),
  selected = plan,
  composition = "score/revision",
  admitted = true,
) =>
  next(state, {
    type: "CANDIDATE_CHANGED",
    plan: selected,
    composition,
    admitted,
  });
const start = () => next(candidate(), { type: "START_REQUESTED" });
function running() {
  const scheduled = start(),
    executionId = ownedExecution(scheduled)!.executionId;
  const preparing = next(scheduled, { type: "PREPARATION_READY", executionId });
  return next(preparing, { type: "START_SUCCEEDED", executionId });
}
function completed() {
  const state = running();
  return next(state, {
    type: "NATURAL_COMPLETION",
    executionId: ownedExecution(state)!.executionId,
    session,
    observation: stepObservation,
  });
}
const id = (state: PracticeExecutionActorState) =>
  ownedExecution(state)!.executionId;
const releaseFailure = {
  mode: "STEP_BY_STEP",
  code: "STEP_RESOURCE_CLEANUP_FAILED",
} as const;

describe("Practice execution ownership machine", () => {
  it("End retirement fences ordinary observations while capturing one matching formal completion", () => {
    const active = running(),
      executionId = id(active);
    const retiring = transitionExecution(active, { type: "END_REQUESTED" });
    expect(retiring.state).toMatchObject({
      tag: "RELEASING",
      reason: "END",
      phase: "RETIRING",
      naturalCompletion: null,
    });
    expect(retiring.effects.map((effect) => effect.kind)).toEqual([
      "RETIRE_CONTROLLER",
    ]);
    expect(
      next(retiring.state, {
        type: "CONTROLLER_CHANGED",
        executionId,
        observation: stepObservation,
      }),
    ).toBe(retiring.state);
    expect(next(retiring.state, { type: "START_SUCCEEDED", executionId })).toBe(
      retiring.state,
    );
    const event = {
      type: "NATURAL_COMPLETION",
      executionId,
      session,
      observation: stepObservation,
    } as const;
    expect(
      next(retiring.state, { ...event, executionId: executionId + 1 }),
    ).toBe(retiring.state);
    const captured = transitionExecution(retiring.state, event);
    expect(captured.effects).toEqual([]);
    expect(next(captured.state, event)).toBe(captured.state);
    expect(next(captured.state, { type: "RETRY_REQUESTED" })).toBe(
      captured.state,
    );
    const complete = transitionExecution(captured.state, {
      type: "RETIREMENT_SUCCEEDED",
      executionId,
    });
    expect(complete.state.tag).toBe("COMPLETED");
    expect(complete.effects.map((effect) => effect.kind)).toEqual([
      "NOTIFY_COMPLETION",
    ]);
    expect(next(complete.state, event)).toBe(complete.state);
    expect(
      next(complete.state, { type: "RETIREMENT_SUCCEEDED", executionId }),
    ).toBe(complete.state);
  });
  it.each(["REPLACEMENT", "ADMISSION", "DISPOSE"] as const)(
    "%s prevents late completion from crossing a hard retirement fence",
    (reason) => {
      const active = running(),
        executionId = id(active);
      let state = next(active, { type: "END_REQUESTED" });
      state =
        reason === "DISPOSE"
          ? next(state, { type: "DISPOSE_REQUESTED" })
          : next(state, {
              type: "CANDIDATE_CHANGED",
              plan: reason === "ADMISSION" ? null : plan,
              composition:
                reason === "REPLACEMENT" ? "other" : "score/revision",
              admitted: reason === "REPLACEMENT",
            });
      expect(state).toMatchObject({
        tag: "RELEASING",
        phase: "DISPOSING",
        reason: reason === "DISPOSE" ? "DISPOSE" : "REPLACEMENT",
      });
      expect(
        next(state, {
          type: "NATURAL_COMPLETION",
          executionId,
          session,
          observation: stepObservation,
        }),
      ).toBe(state);
      expect(next(state, { type: "RETIREMENT_SUCCEEDED", executionId })).toBe(
        state,
      );
    },
  );
  it("hard teardown supersedes a remembered completion before retirement settlement", () => {
    const active = running(),
      executionId = id(active);
    const captured = next(next(active, { type: "END_REQUESTED" }), {
      type: "NATURAL_COMPLETION",
      executionId,
      session,
      observation: stepObservation,
    });
    const hard = transitionExecution(captured, { type: "DISPOSE_REQUESTED" });
    expect(hard.effects.map((effect) => effect.kind)).toEqual([
      "DISPOSE_CONTROLLER",
    ]);
    expect(
      next(hard.state, { type: "RETIREMENT_SUCCEEDED", executionId }),
    ).toBe(hard.state);
    expect(
      next(hard.state, { type: "RELEASE_SUCCEEDED", executionId }).tag,
    ).toBe("DISPOSED");
  });
  it("temporary Start-readiness loss does not revoke an accepted execution or its End retirement", () => {
    let state = running();
    const executionId = id(state);
    state = candidate(state, plan, "score/revision", false);
    expect(state.tag).toBe("RUNNING");
    state = next(state, { type: "END_REQUESTED" });
    state = candidate(state, plan, "score/revision", false);
    expect(state).toMatchObject({
      tag: "RELEASING",
      reason: "END",
      phase: "RETIRING",
    });
    state = next(state, {
      type: "NATURAL_COMPLETION",
      executionId,
      session,
      observation: stepObservation,
    });
    expect(next(state, { type: "RETIREMENT_SUCCEEDED", executionId }).tag).toBe(
      "COMPLETED",
    );
  });
  it("React lifetime teardown hard-fences without permanently disposing a remountable actor", () => {
    const active = running(),
      executionId = id(active);
    const released = transitionExecution(
      next(active, { type: "END_REQUESTED" }),
      { type: "TEARDOWN_REQUESTED" },
    );
    expect(released.state).toMatchObject({
      tag: "RELEASING",
      reason: "DISPOSE",
      phase: "DISPOSING",
      destination: { kind: "READY" },
    });
    expect(released.effects.map((effect) => effect.kind)).toEqual([
      "DISPOSE_CONTROLLER",
    ]);
    expect(
      next(released.state, {
        type: "NATURAL_COMPLETION",
        executionId,
        session,
        observation: stepObservation,
      }),
    ).toBe(released.state);
    expect(
      next(released.state, { type: "RELEASE_SUCCEEDED", executionId }).tag,
    ).toBe("READY");
  });
  it("natural completion cancels a queued Start rather than silently starting a new attempt", () => {
    const active = running(),
      executionId = id(active);
    const queued = next(next(active, { type: "END_REQUESTED" }), {
      type: "START_REQUESTED",
    });
    const captured = next(queued, {
      type: "NATURAL_COMPLETION",
      executionId,
      session,
      observation: stepObservation,
    });
    const result = transitionExecution(captured, {
      type: "RETIREMENT_SUCCEEDED",
      executionId,
    });
    expect(result.state.tag).toBe("COMPLETED");
    expect(ownedExecution(result.state)?.plan).toBe(plan);
    expect(result.effects.map((effect) => effect.kind)).toEqual([
      "NOTIFY_COMPLETION",
    ]);
  });
  it("retirement failure still waits hard disposal before exposing a stable release error", () => {
    const active = running(),
      executionId = id(active);
    const failed = transitionExecution(
      next(active, { type: "END_REQUESTED" }),
      { type: "RETIREMENT_FAILED", executionId, failure: releaseFailure },
    );
    expect(failed.state).toMatchObject({
      tag: "RELEASING",
      phase: "DISPOSING",
      retirementFailure: releaseFailure,
    });
    expect(failed.effects.map((effect) => effect.kind)).toEqual([
      "DISPOSE_CONTROLLER",
    ]);
    const result = next(failed.state, {
      type: "RELEASE_SUCCEEDED",
      executionId,
    });
    expect(result).toMatchObject({
      tag: "ERROR",
      error: { kind: "RELEASE", failure: releaseFailure },
    });
    expect(next(result, { type: "START_REQUESTED" })).toBe(result);
  });
  it("requires an admitted candidate and emits exactly one prepare/construct sequence for double Start", () => {
    expect(next(initialExecutionState(), { type: "START_REQUESTED" })).toEqual(
      initialExecutionState(),
    );
    expect(
      next(candidate(initialExecutionState(), plan, "score", false), {
        type: "START_REQUESTED",
      }).tag,
    ).toBe("READY");
    const first = transitionExecution(candidate(), { type: "START_REQUESTED" });
    expect(first.state.tag).toBe("STARTING");
    expect(first.effects.map((e) => e.kind)).toEqual(["PREPARE"]);
    expect(
      transitionExecution(first.state, { type: "START_REQUESTED" }).effects,
    ).toEqual([]);
    const ready = transitionExecution(first.state, {
      type: "PREPARATION_READY",
      executionId: id(first.state),
    });
    expect(ready.effects.map((e) => e.kind)).toEqual(["START_CONTROLLER"]);
    expect(
      transitionExecution(ready.state, {
        type: "PREPARATION_READY",
        executionId: id(first.state),
      }).effects,
    ).toEqual([]);
  });
  it.each(["STARTING", "RUNNING"] as const)(
    "End during %s fences all old outcomes before release",
    (tag) => {
      const active = tag === "STARTING" ? start() : running();
      let state = next(active, { type: "END_REQUESTED" });
      expect(state.tag).toBe("RELEASING");
      expect(ownedExecution(state)).toBeNull();
      for (const event of [
        { type: "PREPARATION_READY", executionId: id(active) },
        { type: "START_SUCCEEDED", executionId: id(active) },
        {
          type: "CONTROLLER_CHANGED",
          executionId: id(active),
          observation: stepObservation,
        },
      ] as const)
        expect(next(state, event)).toBe(state);
      const retired = transitionExecution(state, {
        type: "RETIREMENT_SUCCEEDED",
        executionId: id(active),
      });
      expect(retired.state).toMatchObject({
        tag: "RELEASING",
        reason: "END",
        phase: "DISPOSING",
      });
      expect(retired.effects.map((effect) => effect.kind)).toEqual([
        "DISPOSE_CONTROLLER",
      ]);
      state = retired.state;
      state = next(state, {
        type: "RELEASE_SUCCEEDED",
        executionId: id(active),
      });
      expect(state.tag).toBe("READY");
      expect(projectExecutionView(state).executedPlan).toBeNull();
    },
  );
  it("Dispose during Start waits release and is idempotent", () => {
    const active = start(),
      releasing = next(active, { type: "DISPOSE_REQUESTED" });
    expect(releasing.tag).toBe("RELEASING");
    expect(
      transitionExecution(releasing, { type: "DISPOSE_REQUESTED" }).effects,
    ).toEqual([]);
    const disposed = next(releasing, {
      type: "RELEASE_SUCCEEDED",
      executionId: id(active),
    });
    expect(disposed.tag).toBe("DISPOSED");
    expect(next(disposed, { type: "START_REQUESTED" })).toBe(disposed);
    expect(next(disposed, { type: "DISPOSE_REQUESTED" })).toBe(disposed);
  });
  it("accepted plan survives candidate edits and view projection is pure", () => {
    const active = running(),
      different = stepPracticePlan(artifact as PracticeScoreArtifact, {
        metronomeEnabled: true,
      });
    const updated = candidate(active, different);
    expect(ownedExecution(updated)!.plan).toBe(plan);
    expect(projectExecutionView(updated)).toEqual(
      projectExecutionView(updated),
    );
    expect(projectExecutionView(updated).executedPlan).toBe(plan);
  });
  it("composition replacement fences the old execution and never auto-starts", () => {
    const active = running(),
      replaced = candidate(active, plan, "replacement");
    expect(replaced.tag).toBe("RELEASING");
    const released = transitionExecution(replaced, {
      type: "RELEASE_SUCCEEDED",
      executionId: id(active),
    });
    expect(released.state.tag).toBe("READY");
    expect(released.effects).toEqual([]);
    expect(
      next(released.state, {
        type: "CONTROLLER_CHANGED",
        executionId: id(active),
        observation: stepObservation,
      }),
    ).toBe(released.state);
  });
  it("natural completion transitions before notification and ignores duplicates / STOPPED_BY_USER", () => {
    const active = running(),
      executionId = id(active);
    const stopped = {
      ...session,
      completionReason: "STOPPED_BY_USER",
    } as ExecutionCompletion;
    expect(
      next(active, {
        type: "NATURAL_COMPLETION",
        executionId,
        session: stopped,
        observation: stepObservation,
      }),
    ).toBe(active);
    const result = transitionExecution(active, {
      type: "NATURAL_COMPLETION",
      executionId,
      session,
      observation: stepObservation,
    });
    expect(result.state.tag).toBe("COMPLETED");
    expect(result.effects.map((e) => e.kind)).toEqual(["NOTIFY_COMPLETION"]);
    expect(
      transitionExecution(result.state, {
        type: "NATURAL_COMPLETION",
        executionId,
        session,
        observation: stepObservation,
      }).effects,
    ).toEqual([]);
  });
  it.each(["END_FIRST", "COMPLETION_FIRST"] as const)(
    "End/completion ordering: %s",
    (order) => {
      const active = running(),
        executionId = id(active);
      const event = {
        type: "NATURAL_COMPLETION",
        executionId,
        session,
        observation: stepObservation,
      } as const;
      if (order === "END_FIRST") {
        const retiring = transitionExecution(
          next(active, { type: "END_REQUESTED" }),
          event,
        );
        expect(retiring.state).toMatchObject({
          tag: "RELEASING",
          reason: "END",
          phase: "RETIRING",
          naturalCompletion: { session },
        });
        expect(retiring.effects).toEqual([]);
        const settled = transitionExecution(retiring.state, {
          type: "RETIREMENT_SUCCEEDED",
          executionId,
        });
        expect(settled.state.tag).toBe("COMPLETED");
        expect(settled.effects.map((effect) => effect.kind)).toEqual([
          "NOTIFY_COMPLETION",
        ]);
      } else {
        const result = transitionExecution(active, event);
        expect(result.state.tag).toBe("COMPLETED");
        expect(next(result.state, { type: "END_REQUESTED" }).tag).toBe(
          "COMPLETED",
        );
      }
    },
  );
  it("Continuous completion requires its atomic result/recording payload", () => {
    const selected = continuousPracticePlan(artifact as PracticeScoreArtifact);
    const scheduled = next(
      next(initialExecutionState(), {
        type: "CANDIDATE_CHANGED",
        plan: selected,
        composition: "score",
        admitted: true,
      }),
      { type: "START_REQUESTED" },
    );
    const observation: ExecutionObservation = {
      mode: "CONTINUOUS_PLAY",
      error: null,
      phase: "ACTIVE",
      transport: null,
      evaluation: null,
      recordingIndicator: null,
      analysisIntervention: null,
      resourceIntervention: null,
      completion: null,
    };
    const missing = transitionExecution(scheduled, {
      type: "NATURAL_COMPLETION",
      executionId: id(scheduled),
      session,
      observation,
    });
    expect(missing.state.tag).toBe("ERROR");
    expect(missing.effects).toEqual([]);
    const valid = next(scheduled, {
      type: "NATURAL_COMPLETION",
      executionId: id(scheduled),
      session,
      observation: {
        ...observation,
        completion: {
          result: canonicalContinuousResultFixture(),
          recording: { status: "NOT_RECORDED" },
        },
      },
    });
    expect(valid.tag).toBe("COMPLETED");
  });
  it("Retry reserves the exact executed plan and starts only on complete release", () => {
    const done = completed(),
      changed = candidate(
        done,
        stepPracticePlan(artifact as PracticeScoreArtifact, {
          metronomeEnabled: true,
        }),
      );
    const retry = transitionExecution(changed, { type: "RETRY_REQUESTED" });
    expect(retry.state.tag).toBe("RELEASING");
    expect(retry.effects.map((e) => e.kind)).toEqual(["DISPOSE_CONTROLLER"]);
    const restarted = transitionExecution(retry.state, {
      type: "RELEASE_SUCCEEDED",
      executionId: id(done),
    });
    expect(restarted.state.tag).toBe("STARTING");
    expect(ownedExecution(restarted.state)!.plan).toBe(plan);
    expect(id(restarted.state)).not.toBe(id(done));
    expect(restarted.effects.map((e) => e.kind)).toEqual(["PREPARE"]);
    expect(
      next(restarted.state, {
        type: "RELEASE_FAILED",
        executionId: id(done),
        failure: releaseFailure,
      }),
    ).toBe(restarted.state);
  });
  it("Retry requires completion/admission and is cancelled by admission loss or composition replacement while releasing", () => {
    expect(
      transitionExecution(running(), { type: "RETRY_REQUESTED" }).effects,
    ).toEqual([]);
    const done = completed();
    expect(
      transitionExecution(candidate(done, plan, "score/revision", false), {
        type: "RETRY_REQUESTED",
      }).effects,
    ).toEqual([]);
    for (const replacement of [false, true]) {
      const releasing = next(done, { type: "RETRY_REQUESTED" });
      const changed = candidate(
        releasing,
        plan,
        replacement ? "replacement" : "score/revision",
        replacement,
      );
      const released = transitionExecution(changed, {
        type: "RELEASE_SUCCEEDED",
        executionId: id(done),
      });
      expect(released.state.tag).toBe("READY");
      expect(released.effects).toEqual([]);
    }
  });
  it("release failure discards queued Start and cannot be cleared by Start/End/candidate changes", () => {
    const active = running(),
      releasing = next(next(active, { type: "END_REQUESTED" }), {
        type: "RETIREMENT_SUCCEEDED",
        executionId: id(active),
      });
    const queued = next(releasing, { type: "START_REQUESTED" });
    const failed = next(queued, {
      type: "RELEASE_FAILED",
      executionId: id(active),
      failure: releaseFailure,
    });
    expect(failed.tag).toBe("ERROR");
    expect(projectExecutionView(failed).canStart).toBe(false);
    expect(next(failed, { type: "START_REQUESTED" })).toBe(failed);
    expect(next(failed, { type: "END_REQUESTED" })).toBe(failed);
    expect(projectExecutionView(candidate(failed)).canStart).toBe(false);
  });
  it("controller construction/start failures retain identity for explicit release; stale successes cannot revive them", () => {
    const active = start(),
      executionId = id(active);
    const failed = next(active, {
      type: "START_FAILED",
      executionId,
      failure: { mode: "STEP_BY_STEP", code: "STEP_ATTEMPT_FAILED" },
    });
    expect(failed.tag).toBe("ERROR");
    expect(next(failed, { type: "START_SUCCEEDED", executionId })).toBe(failed);
    expect(next(failed, { type: "END_REQUESTED" }).tag).toBe("RELEASING");
  });
  it("subscription notifications during startup update only the accepted observation", () => {
    const active = start(),
      executionId = id(active);
    const changed = next(active, {
      type: "CONTROLLER_CHANGED",
      executionId,
      observation: stepObservation,
    });
    expect(changed.tag).toBe("STARTING");
    expect(ownedExecution(changed)!.observation).toBe(stepObservation);
    expect(ownedExecution(active)!.observation).toBeNull();
  });
});
