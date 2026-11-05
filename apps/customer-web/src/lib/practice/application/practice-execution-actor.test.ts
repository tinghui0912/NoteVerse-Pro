import { metronomeAudioFixture } from "@/lib/practice/__fixtures__/metronome";
import { beforeEach, expect, it, vi } from "vitest";
import {
  PracticeExecutionActor,
  type PracticeExecutionFactories,
} from "./practice-execution-actor";
import {
  continuousPracticePlan,
  stepPracticePlan,
} from "../__fixtures__/practice-plan";
import { rootHealthFixture } from "../__fixtures__/root-health";
import { borrowedDevices } from "../__fixtures__/device-roots";
import { canonicalContinuousResultFixture } from "../__fixtures__/continuous-result";
import artifactJson from "../__fixtures__/canonical-practice-score-artifact.json";
import type { PracticeScoreArtifact } from "../score/artifact";
import * as stepPlatform from "../step/step-platform";
import * as continuousPlatform from "../continuous/continuous-platform";
import { ManualClock } from "../session/timebase";

const artifact = artifactJson as PracticeScoreArtifact;
const tick = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
beforeEach(() => {
  vi.restoreAllMocks();
});
function rig(mode: "STEP_BY_STEP" | "CONTINUOUS_PLAY" = "STEP_BY_STEP") {
  const health = rootHealthFixture(),
    created: {
      options:
        | Parameters<PracticeExecutionFactories["step"]>[0]
        | Parameters<PracticeExecutionFactories["continuous"]>[0];
      controller: ReturnType<PracticeExecutionFactories["step"]> &
        ReturnType<PracticeExecutionFactories["continuous"]>;
      completion: import("../continuous/completion").ContinuousPracticeCompletion;
      emit(): void;
      complete(): void;
      stale(): void;
      staleObservation(): void;
      disposeGate: ReturnType<typeof deferred> | null;
      startGate: ReturnType<typeof deferred> | null;
    }[] = [];
  const create = (
    options:
      | Parameters<PracticeExecutionFactories["step"]>[0]
      | Parameters<PracticeExecutionFactories["continuous"]>[0],
  ) => {
    let state = "IDLE",
      session = "IDLE",
      detachHealth: (() => void) | undefined;
    const subscribers = new Set<() => void>();
    const savedCallbacks: (() => void)[] = [];
    let disposed = false;
    const result = canonicalContinuousResultFixture(),
      payload = { result, recording: { status: "NOT_RECORDED" as const } };
    const sessionSnapshot = {
      completionReason: "SCOPE_COMPLETED" as const,
      localSessionId: `session-${created.length}`,
    };
    const item = {
      options,
      completion: payload,
      controller: null as never,
      emit: () => subscribers.forEach((f) => f()),
      complete: () => {
        state = "ENDED";
        session = "COMPLETE";
        item.emit();
        options.onNaturalCompletion?.(sessionSnapshot as never);
      },
      stale: () => {
        savedCallbacks.forEach((f) => f());
        options.onNaturalCompletion?.(sessionSnapshot as never);
      },
      staleObservation: () => savedCallbacks.forEach((f) => f()),
      disposeGate: null as ReturnType<typeof deferred> | null,
      startGate: null as ReturnType<typeof deferred> | null,
    };
    const controller = {
      start: vi.fn(async () => {
        state = "PREPARING";
        session = "PREPARING";
        item.emit();
        detachHealth = health.port.subscribe(() => {});
        await item.startGate?.promise;
        if (!disposed) {
          state = "ACTIVE";
          session = "ACTIVE";
          item.emit();
        }
      }),
      dispose: vi.fn(async () => {
        disposed = true;
        detachHealth?.();
        state = "DISPOSED";
        session = "DISPOSED";
        await item.disposeGate?.promise;
      }),
      abandon: vi.fn(async () => {
        detachHealth?.();
      }),
      subscribe: vi.fn((f: () => void) => {
        subscribers.add(f);
        savedCallbacks.push(f);
        return () => subscribers.delete(f);
      }),
      snapshot: () =>
        options.plan.mode === "STEP_BY_STEP"
          ? {
              state,
              error: null,
              analysisIntervention: null,
              infrastructureIntervention: null,
              stepInteractionPhase: "READY",
              canAcceptAttempt: true,
              pendingPostVerdict: null,
              activeStepGroup:
                options.plan.source.artifact.moments[
                  options.plan.scope.startIndex
                ],
              sessionSnapshot,
              lastSnapshot: sessionSnapshot,
            }
          : {
              session,
              transport:
                session === "ACTIVE"
                  ? { state: "RUNNING", performanceTimeMs: 5 }
                  : null,
              analysis: "NOT_REQUIRED",
              inputError: null,
              recording: null,
              evaluation: null,
              analysisIntervention: null,
              resourceIntervention: null,
              completed: session === "COMPLETE" ? payload : null,
            },
      setMetronomeEnabled: vi.fn(),
      skip: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      continueWithoutAnalysis: vi.fn(async () => {}),
      continueWithoutRecording: vi.fn(),
      continueAfterRecovery: vi.fn(() => true),
    } as unknown as ReturnType<PracticeExecutionFactories["step"]> &
      ReturnType<PracticeExecutionFactories["continuous"]>;
    Object.assign(item, { controller });
    created.push(item);
    return controller;
  };
  const factories: PracticeExecutionFactories = {
    step: vi.fn(create),
    continuous: vi.fn(create),
  };
  const borrowRoots = vi.fn(() => borrowedDevices()),
    acquireInference = vi.fn();
  const actor = new PracticeExecutionActor(
    { borrowRoots, rootHealth: health.port, acquireInference },
    factories,
  );
  const plan =
    mode === "STEP_BY_STEP"
      ? stepPracticePlan(artifact)
      : continuousPracticePlan(artifact);
  actor.setCandidate(plan, true, "score/revision");
  return {
    actor,
    health,
    created,
    factories,
    plan,
    borrowRoots,
    acquireInference,
  };
}
it.each(["STEP_BY_STEP", "CONTINUOUS_PLAY"] as const)(
  "%s READY has no controller, subscription or resource use",
  async (mode) => {
    const r = rig(mode);
    expect(r.actor.snapshot()).toMatchObject({
      mode,
      lifecycle: "READY",
      executedPlan: null,
      canStart: true,
    });
    expect(r.created).toHaveLength(0);
    expect(r.health.listenerCount()).toBe(0);
    expect(r.acquireInference).not.toHaveBeenCalled();
    expect(r.borrowRoots).not.toHaveBeenCalled();
    const first = r.actor.start(),
      second = r.actor.start();
    expect(second).toBe(first);
    await first;
    expect(r.created).toHaveLength(1);
    expect(r.health.listenerCount()).toBe(1);
    expect(r.factories.step).toHaveBeenCalledTimes(
      mode === "STEP_BY_STEP" ? 1 : 0,
    );
    expect(r.factories.continuous).toHaveBeenCalledTimes(
      mode === "CONTINUOUS_PLAY" ? 1 : 0,
    );
    expect(r.actor.snapshot().executedPlan).toBe(r.plan);
    await r.actor.dispose();
    expect(r.health.listenerCount()).toBe(0);
  },
);
it("candidate edits change only pre-Start intent and active execution keeps its captured plan", async () => {
  const r = rig(),
    scope = {
      kind: "RANGE" as const,
      startGroupId: artifact.moments[1].groupId,
      endGroupId: artifact.moments[2].groupId,
    };
  const latest = stepPracticePlan(artifact, {
    scope,
    tempoSelection: { mode: "CUSTOM_FIXED_BPM", bpm: 100 },
    metronomeEnabled: true,
  });
  r.actor.setCandidate(latest, true, "score/revision");
  expect(r.created).toHaveLength(0);
  await r.actor.start();
  expect(r.created[0].options.plan).toBe(latest);
  r.actor.setCandidate(r.plan, true, "score/revision");
  r.actor.setMetronomeEnabled(false);
  expect(r.actor.snapshot().executedPlan).toBe(latest);
  expect(r.created).toHaveLength(1);
  expect(
    r.created[0].controller.setMetronomeEnabled,
  ).toHaveBeenCalledExactlyOnceWith(false);
  await r.actor.dispose();
});
it.each(["STEP_BY_STEP", "CONTINUOUS_PLAY"] as const)(
  "%s End returns READY; fresh Start creates a fresh actor",
  async (mode) => {
    const r = rig(mode);
    await r.actor.start();
    const first = r.created[0];
    const ending = r.actor.end(),
      twice = r.actor.end();
    await Promise.all([ending, twice]);
    expect(r.actor.snapshot()).toMatchObject({
      lifecycle: "READY",
      executedPlan: null,
    });
    expect(r.created).toHaveLength(1);
    expect(first.controller.dispose).toHaveBeenCalledOnce();
    expect(r.health.listenerCount()).toBe(0);
    await r.actor.start();
    expect(r.created).toHaveLength(2);
    expect(r.created[1].controller).not.toBe(first.controller);
    await r.actor.dispose();
  },
);
it.each(["STEP_BY_STEP", "CONTINUOUS_PLAY"] as const)(
  "%s natural completion notifies once; double Retry directly starts one fresh attempt",
  async (mode) => {
    const r = rig(mode),
      completed = vi.fn();
    r.actor.setCompletionListener(completed);
    await r.actor.start();
    const first = r.created[0];
    first.complete();
    first.complete();
    expect(r.actor.snapshot().lifecycle).toBe("COMPLETED");
    expect(completed).toHaveBeenCalledOnce();
    expect(r.created).toHaveLength(1);
    expect(r.actor.snapshot().completion).toBe(
      mode === "CONTINUOUS_PLAY" ? first.completion : null,
    );
    first.disposeGate = deferred();
    const retry = r.actor.retry(),
      duplicate = r.actor.retry();
    expect(duplicate).toBe(retry);
    await tick();
    expect(r.created).toHaveLength(1);
    first.disposeGate.resolve();
    await retry;
    expect(r.created).toHaveLength(2);
    expect(r.actor.snapshot().completion).toBeNull();
    expect(r.health.listenerCount()).toBe(1);
    await r.actor.dispose();
  },
);
it("release serialization fences Start pending + End + new Start and all stale callbacks", async () => {
  const r = rig(),
    completion = vi.fn();
  r.actor.setCompletionListener(completion);
  const create = vi.mocked(r.factories.step).getMockImplementation()!;
  vi.mocked(r.factories.step).mockImplementationOnce((...args) => {
    const controller = create(...args);
    r.created[0].startGate = deferred();
    return controller;
  });
  const starting = r.actor.start();
  await tick();
  const old = r.created[0];
  old.disposeGate = deferred();
  const ending = r.actor.end();
  const fresh = r.actor.start();
  await tick();
  expect(r.created).toHaveLength(1);
  expect(r.health.listenerCount()).toBe(0);
  old.staleObservation();
  expect(completion).not.toHaveBeenCalled();
  old.disposeGate.resolve();
  await tick();
  expect(r.created).toHaveLength(1);
  old.startGate!.resolve();
  await Promise.all([starting, ending, fresh]);
  expect(r.created).toHaveLength(2);
  const snapshot = r.actor.snapshot();
  old.stale();
  expect(r.actor.snapshot()).toBe(snapshot);
  expect(completion).not.toHaveBeenCalled();
  await r.actor.dispose();
});
it("composition replacement retires the old actor; candidate-only rerenders do not", async () => {
  const r = rig();
  await r.actor.start();
  const first = r.created[0];
  first.disposeGate = deferred();
  r.actor.setCandidate(
    continuousPracticePlan(artifact),
    true,
    "another/revision",
  );
  expect(r.actor.snapshot().lifecycle).toBe("READY");
  const start = r.actor.start();
  await tick();
  expect(r.created).toHaveLength(1);
  first.disposeGate.resolve();
  await start;
  expect(r.created[1].options.plan.mode).toBe("CONTINUOUS_PLAY");
  await r.actor.dispose();
});
it("disposal during pending Start fences completion and waits for late preparation", async () => {
  const r = rig();
  const create = vi.mocked(r.factories.step).getMockImplementation()!;
  vi.mocked(r.factories.step).mockImplementationOnce((...args) => {
    const result = create(...args);
    r.created[0].startGate = deferred();
    return result;
  });
  const completion = vi.fn();
  r.actor.setCompletionListener(completion);
  const start = r.actor.start();
  await tick();
  let done = false;
  const disposed = r.actor.dispose().then(() => {
    done = true;
  });
  await tick();
  expect(done).toBe(false);
  r.created[0].stale();
  expect(completion).not.toHaveBeenCalled();
  r.created[0].startGate!.resolve();
  await Promise.all([disposed, start]);
  await r.actor.start();
  expect(r.created).toHaveLength(1);
  expect(r.health.listenerCount()).toBe(0);
});
it("an immediate End cancels Start before construction and invalid admission cannot Start or Retry", async () => {
  const r = rig();
  const start = r.actor.start();
  await r.actor.end();
  await start;
  expect(r.created).toHaveLength(0);
  r.actor.setCandidate(r.plan, false, "score/revision");
  await r.actor.start();
  await r.actor.retry();
  expect(r.created).toHaveLength(0);
  r.actor.setCandidate(null, true, "score/revision");
  await r.actor.start();
  expect(r.created).toHaveLength(0);
  await r.actor.dispose();
});
it("accepted Continuous completion survives End and only Retry creates a new execution", async () => {
  const r = rig("CONTINUOUS_PLAY");
  expect(r.actor.snapshot().completion).toBeNull();
  await r.actor.start();
  const first = r.created[0];
  first.complete();
  const payload = r.actor.snapshot().completion;
  expect(payload).toBe(first.completion);
  r.actor.setCandidate(r.plan, true, "score/revision");
  expect(r.actor.snapshot().completion).toBe(payload);
  await r.actor.end();
  expect(r.actor.snapshot().completion).toBe(payload);
  first.stale();
  expect(r.actor.snapshot().completion).toBe(payload);
  await r.actor.retry();
  expect(r.actor.snapshot().completion).toBeNull();
  first.stale();
  expect(r.actor.snapshot().completion).toBeNull();
  await r.actor.dispose();
});
it("cleanup failure remains visible and prevents overlapping replacement ownership", async () => {
  const r = rig();
  await r.actor.start();
  vi.mocked(r.created[0].controller.dispose).mockRejectedValueOnce(
    new Error("STEP_RESOURCE_CLEANUP_FAILED"),
  );
  await r.actor.end();
  expect(r.actor.snapshot()).toMatchObject({
    lifecycle: "ERROR",
    inputError: "STEP_RESOURCE_CLEANUP_FAILED",
    canStart: false,
  });
  await r.actor.start();
  expect(r.created).toHaveLength(1);
  await r.actor.dispose();
});
it("real STEP explicitly starts without count-in, waits for input, and next Start has a new localSessionId", async () => {
  const clock = new ManualClock(100),
    health = rootHealthFixture();
  const createMidi = vi.fn(() => ({
    start: vi.fn(async () => {}),
    refreshInputs: vi.fn(),
    dispose: vi.fn(),
  }));
  const platform = vi
    .spyOn(stepPlatform, "browserStepPlatform")
    .mockReturnValue({
      clock,
      timer: { schedule: vi.fn(), cancel: vi.fn() },
      createMidi,
      createMetronomeAudio: () => metronomeAudioFixture(),
    });
  const continuous = vi.spyOn(continuousPlatform, "browserContinuousPlatform");
  const actor = new PracticeExecutionActor({
    borrowRoots: () => borrowedDevices(),
    rootHealth: health.port,
  });
  actor.setCandidate(stepPracticePlan(artifact), true, "score/revision");
  expect(platform).not.toHaveBeenCalled();
  expect(continuous).not.toHaveBeenCalled();
  await actor.start();
  const first = actor.snapshot();
  expect(first).toMatchObject({
    mode: "STEP_BY_STEP",
    lifecycle: "ACTIVE",
    stepInteractionPhase: "READY",
    performanceClock: null,
  });
  clock.advance(100000);
  expect(actor.snapshot()).toBe(first);
  expect(health.listenerCount()).toBe(1);
  const firstId = Reflect.get(vi.mocked(platform).mock.results[0], "value");
  expect(firstId).toBeDefined();
  const controllerIds: string[] = [];
  // The actual MIDI binding's timebase carries the local session identity.
  controllerIds.push(
    createMidi.mock.calls.length
      ? (
          vi.mocked(createMidi).mock.calls[0] as unknown as [
            { timebase: { domainId: string } },
          ]
        )[0].timebase.domainId
      : "",
  );
  await actor.end();
  expect(actor.snapshot().lifecycle).toBe("READY");
  await actor.start();
  controllerIds.push(
    (
      vi.mocked(createMidi).mock.calls[1] as unknown as [
        { timebase: { domainId: string } },
      ]
    )[0].timebase.domainId,
  );
  expect(controllerIds[1]).not.toBe(controllerIds[0]);
  expect(continuous).not.toHaveBeenCalled();
  await actor.dispose();
});

it.each(["STEP_BY_STEP", "CONTINUOUS_PLAY"] as const)(
  "%s unexpected adapter exception stays diagnostic and cannot enter the public view",
  async (mode) => {
    const r = rig(mode),
      cause = new Error("NO_CONNECTED_INPUT https://private/model stack");
    vi.mocked(
      mode === "STEP_BY_STEP" ? r.factories.step : r.factories.continuous,
    ).mockImplementationOnce(() => {
      throw cause;
    });
    await r.actor.start();
    expect(r.actor.snapshot()).toMatchObject({
      lifecycle: "ERROR",
      inputError:
        mode === "STEP_BY_STEP" ? "STEP_ATTEMPT_FAILED" : "ANALYSIS_FAILED",
    });
    expect(r.actor.engineeringSnapshot().failureCause).toBe(cause);
    await r.actor.dispose();
  },
);
it.each(["STEP_BY_STEP", "CONTINUOUS_PLAY"] as const)(
  "%s cleanup rejects with an owned stable code regardless of exception text",
  async (mode) => {
    const r = rig(mode);
    await r.actor.start();
    const cause = new Error("NotAllowedError: private cleanup URL");
    vi.mocked(r.created[0].controller.dispose).mockRejectedValueOnce(cause);
    await r.actor.end();
    expect(r.actor.snapshot()).toMatchObject({
      inputError:
        mode === "STEP_BY_STEP"
          ? "STEP_RESOURCE_CLEANUP_FAILED"
          : "RESOURCE_CLEANUP_FAILED",
      canStart: false,
    });
    expect(r.actor.engineeringSnapshot().failureCause).toBe(cause);
    await r.actor.start();
    expect(r.created).toHaveLength(1);
    await r.actor.dispose();
  },
);

it.each(["STEP_BY_STEP", "CONTINUOUS_PLAY"] as const)(
  "%s an unexpected controller Start rejection is terminal application state",
  async (mode) => {
    const r = rig(mode),
      cause = new Error("NotAllowedError https://private");
    if (mode === "STEP_BY_STEP") {
      const factory = vi.mocked(r.factories.step),
        original = factory.getMockImplementation()!;
      factory.mockImplementationOnce((options, acquire) => {
        const controller = original(options, acquire);
        vi.mocked(controller.start).mockRejectedValueOnce(cause);
        return controller;
      });
    } else {
      const factory = vi.mocked(r.factories.continuous),
        original = factory.getMockImplementation()!;
      factory.mockImplementationOnce((options, acquire) => {
        const controller = original(options, acquire);
        vi.mocked(controller.start).mockRejectedValueOnce(cause);
        return controller;
      });
    }
    await r.actor.start();
    expect(r.actor.snapshot()).toMatchObject({
      lifecycle: "ERROR",
      inputError:
        mode === "STEP_BY_STEP" ? "STEP_ATTEMPT_FAILED" : "ANALYSIS_FAILED",
      canStart: false,
    });
    expect(r.actor.engineeringSnapshot().failureCause).toBe(cause);
    await r.actor.end();
    expect(r.created[0].controller.dispose).toHaveBeenCalledOnce();
    await r.actor.dispose();
  },
);

it("Retry captures the completed executed plan even when candidate preferences change", async () => {
  const r = rig();
  await r.actor.start();
  r.created[0].complete();
  const candidate = stepPracticePlan(artifact, {
    metronomeEnabled: true,
    tempoSelection: { mode: "CUSTOM_FIXED_BPM", bpm: 100 },
  });
  r.actor.setCandidate(candidate, true, "score/revision");
  await r.actor.retry();
  expect(r.created[1].options.plan).toBe(r.plan);
  expect(r.actor.snapshot().executedPlan).toBe(r.plan);
  await r.actor.dispose();
});
it.each(["ADMISSION", "COMPOSITION"] as const)(
  "Retry cannot restart after %s changes during release",
  async (kind) => {
    const r = rig();
    await r.actor.start();
    const previous = r.created[0];
    previous.complete();
    previous.disposeGate = deferred();
    const retry = r.actor.retry();
    r.actor.setCandidate(
      r.plan,
      kind === "COMPOSITION",
      kind === "COMPOSITION" ? "replacement" : "score/revision",
    );
    previous.disposeGate.resolve();
    await retry;
    await tick();
    expect(r.created).toHaveLength(1);
    expect(r.actor.snapshot().executedPlan).toBeNull();
    await r.actor.dispose();
  },
);
it("release failure waits every late preparation and cleanup before reporting ERROR and never constructs the queued attempt", async () => {
  const r = rig(),
    create = vi.mocked(r.factories.step).getMockImplementation()!;
  vi.mocked(r.factories.step).mockImplementationOnce((...args) => {
    const controller = create(...args);
    r.created[0].startGate = deferred();
    vi.mocked(controller.dispose).mockRejectedValueOnce(
      new Error("release failed"),
    );
    return controller;
  });
  const start = r.actor.start();
  await tick();
  const previous = r.created[0];
  let released = false;
  const ending = r.actor.end().then(() => {
    released = true;
  });
  const fresh = r.actor.start();
  await tick();
  expect(released).toBe(false);
  expect(r.created).toHaveLength(1);
  previous.startGate!.resolve();
  await Promise.all([start, ending, fresh]);
  expect(r.created).toHaveLength(1);
  expect(r.actor.snapshot()).toMatchObject({
    lifecycle: "ERROR",
    canStart: false,
  });
  await r.actor.dispose();
});
it("completion listener observes COMPLETED before its exactly-once callback and a later End preserves it", async () => {
  const r = rig(),
    listener = vi.fn(() =>
      expect(r.actor.snapshot().lifecycle).toBe("COMPLETED"),
    );
  r.actor.setCompletionListener(listener);
  await r.actor.start();
  const previous = r.created[0];
  previous.complete();
  previous.complete();
  expect(listener).toHaveBeenCalledOnce();
  const end = r.actor.end();
  previous.stale();
  expect(r.actor.snapshot().executedPlan).toBe(r.plan);
  await end;
  expect(listener).toHaveBeenCalledOnce();
  await r.actor.dispose();
});
it("Continuous refuses completion without the accepted atomic result/recording payload", async () => {
  const r = rig("CONTINUOUS_PLAY"),
    completion = vi.fn();
  await r.actor.start();
  r.actor.setCompletionListener(completion);
  const previous = r.created[0],
    snapshot = previous.controller.snapshot();
  vi.spyOn(previous.controller, "snapshot").mockReturnValue({
    ...snapshot,
    completed: null,
  } as never);
  previous.complete();
  expect(r.actor.snapshot()).toMatchObject({
    lifecycle: "ERROR",
    completion: null,
  });
  expect(completion).not.toHaveBeenCalled();
  await r.actor.dispose();
});
it("mode commands route only to the owned active adapter and disposed actors remain inert", async () => {
  const r = rig();
  r.actor.pause();
  expect(r.created).toHaveLength(0);
  await r.actor.start();
  const controller = r.created[0].controller;
  r.actor.pause();
  r.actor.resume();
  r.actor.continueWithoutRecording();
  await r.actor.continueWithoutAnalysis();
  expect(r.actor.continueAfterRecovery()).toBe(false);
  expect(controller.pause).not.toHaveBeenCalled();
  expect(controller.resume).not.toHaveBeenCalled();
  r.actor.skip();
  expect(controller.skip).toHaveBeenCalledOnce();
  await Promise.all([r.actor.dispose(), r.actor.dispose()]);
  r.actor.skip();
  await r.actor.start();
  expect(controller.skip).toHaveBeenCalledOnce();
  expect(controller.dispose).toHaveBeenCalledOnce();
  expect(r.created).toHaveLength(1);
});

it("candidate-only rerenders do not republish an unchanged active execution view", async () => {
  const r = rig();
  await r.actor.start();
  const before = r.actor.snapshot(),
    changed = vi.fn();
  const detach = r.actor.subscribe(changed);
  r.actor.setCandidate(
    stepPracticePlan(artifact, { metronomeEnabled: true }),
    true,
    "score/revision",
  );
  expect(r.actor.snapshot()).toBe(before);
  expect(changed).not.toHaveBeenCalled();
  detach();
  await r.actor.dispose();
});

it("hard disposal requested reentrantly by a subscriber acknowledges complete release, including pending dispose", async () => {
  const r = rig();
  await r.actor.start();
  const previous = r.created[0];
  previous.disposeGate = deferred();
  let ending: Promise<void> | undefined,
    released = false;
  const detach = r.actor.subscribe(() => {
    if (r.actor.snapshot().lifecycle === "COMPLETED")
      ending = r.actor.dispose().then(() => {
        released = true;
      });
  });
  previous.complete();
  await tick();
  expect(ending).toBeDefined();
  expect(released).toBe(false);
  expect(r.actor.snapshot().executedPlan).toBeNull();
  previous.disposeGate.resolve();
  await ending;
  expect(released).toBe(true);
  detach();
  await r.actor.dispose();
});
