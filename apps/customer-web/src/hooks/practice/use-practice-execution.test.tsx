import { memoryRecordingSinkFactory } from "@/lib/practice/__fixtures__/recording-sink";
import {
  metronomeAudioFixture,
  observeMetronomeRuntime,
} from "@/lib/practice/__fixtures__/metronome";
// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePracticeExecution } from "./use-practice-execution";
import {
  stepPracticePlan,
  continuousPracticePlan,
} from "@/lib/practice/__fixtures__/practice-plan";
import { borrowedDevices } from "@/lib/practice/__fixtures__/device-roots";
import { rootHealthFixture } from "@/lib/practice/__fixtures__/root-health";
import fixture from "@/lib/practice/__fixtures__/canonical-practice-score-artifact.json";
import type { PracticeScoreArtifact } from "@/lib/practice/score/artifact";
import { ManualClock } from "@/lib/practice/session/timebase";
import { StepPracticeController } from "@/lib/practice/step/step-practice-controller";
import { ContinuousPracticeController } from "@/lib/practice/continuous/continuous-practice-controller";
import * as stepPlatform from "@/lib/practice/step/step-platform";
import * as continuousPlatform from "@/lib/practice/continuous/continuous-platform";
import { PerformanceRecorder } from "@/lib/practice/recording/performance-recorder";
const artifact = fixture as PracticeScoreArtifact;
afterEach(() => vi.restoreAllMocks());
function rig() {
  const health = rootHealthFixture(),
    clock = new ManualClock(100),
    borrowRoots = vi.fn(() => borrowedDevices());
  const meter = observeMetronomeRuntime();
  const midi = {
      start: vi.fn(async () => {}),
      refreshInputs: vi.fn(),
      dispose: vi.fn(),
    },
    createMidi = vi.fn(() => midi);
  const step = vi.spyOn(stepPlatform, "browserStepPlatform").mockReturnValue({
    clock,
    timer: { schedule: vi.fn(), cancel: vi.fn() },
    createMidi,
    createMetronomeAudio: () => metronomeAudioFixture(),
  });
  const continuous = vi
    .spyOn(continuousPlatform, "browserContinuousPlatform")
    .mockReturnValue({
      midiClock: clock,
      createMidi,
      createMetronomeAudio: () => metronomeAudioFixture(),
      createRecorder: () =>
        new PerformanceRecorder("OFF", memoryRecordingSinkFactory),
    } as never);
  const completion = vi.fn();
  return {
    health,
    clock,
    meter,
    midi,
    step,
    continuous,
    options: {
      plan: stepPracticePlan(artifact),
      admitted: true,
      compositionId: "score/revision",
      borrowRoots,
      rootHealth: health.port,
      onNaturalCompletion: completion,
    },
    completion,
  };
}
it("StrictMode READY and candidate scope/tempo edits create zero execution platforms, controllers or subscriptions", async () => {
  const r = rig(),
    stepStart = vi.spyOn(StepPracticeController.prototype, "start"),
    continuousStart = vi.spyOn(ContinuousPracticeController.prototype, "start");
  const { result, rerender, unmount } = renderHook(
    (options) => usePracticeExecution(options),
    { initialProps: r.options, wrapper: StrictMode },
  );
  const dispose = vi.spyOn(StepPracticeController.prototype, "dispose");
  await act(async () => {
    await Promise.resolve();
  });
  expect(result.current.canStart).toBe(true);
  expect(dispose).not.toHaveBeenCalled();
  const candidate = stepPracticePlan(artifact, {
    scope: {
      kind: "RANGE",
      startGroupId: artifact.moments[1].groupId,
      endGroupId: artifact.moments[2].groupId,
    },
    tempoSelection: { mode: "CUSTOM_FIXED_BPM", bpm: 100 },
    metronomeEnabled: true,
  });
  rerender({ ...r.options, plan: candidate });
  expect(r.step).not.toHaveBeenCalled();
  expect(r.continuous).not.toHaveBeenCalled();
  expect(r.health.listenerCount()).toBe(0);
  expect(r.midi.start).not.toHaveBeenCalled();
  expect(continuousStart).not.toHaveBeenCalled();
  await act(async () => {
    await result.current.start();
  });
  expect(stepStart).toHaveBeenCalledOnce();
  expect(result.current.executedPlan).toBe(candidate);
  expect(result.current.lifecycle).toBe("ACTIVE");
  const executed = stepStart.mock.contexts[0];
  rerender(r.options);
  act(() => result.current.setMetronomeEnabled(false));
  expect(result.current.executedPlan).toBe(candidate);
  expect(stepStart.mock.contexts[0]).toBe(executed);
  expect(stepStart).toHaveBeenCalledOnce();
  expect(r.meter.setEnabled).toHaveBeenCalledWith(false);
  unmount();
  expect(r.health.listenerCount()).toBe(0);
});
it("Continuous creates no platform until Start, and End returns READY without replacement", async () => {
  const r = rig(),
    start = vi.spyOn(ContinuousPracticeController.prototype, "start"),
    step = vi.spyOn(StepPracticeController.prototype, "start");
  const { result, unmount } = renderHook(() =>
    usePracticeExecution({
      ...r.options,
      plan: continuousPracticePlan(artifact),
    }),
  );
  expect(r.continuous).not.toHaveBeenCalled();
  await act(async () => {
    await result.current.start();
  });
  expect(start).toHaveBeenCalledOnce();
  expect(step).not.toHaveBeenCalled();
  await act(async () => {
    result.current.pause();
  });
  expect(result.current.lifecycle).toBe("PAUSED");
  await act(async () => {
    result.current.resume();
  });
  expect(start).toHaveBeenCalledOnce();
  await act(async () => {
    await result.current.end();
  });
  expect(result.current.lifecycle).toBe("READY");
  expect(r.health.listenerCount()).toBe(0);
  expect(start).toHaveBeenCalledOnce();
  unmount();
});
it("natural STEP completion notifies once and Retry explicitly creates a fresh session", async () => {
  const r = rig(),
    start = vi.spyOn(StepPracticeController.prototype, "start");
  const { result, unmount } = renderHook(() => usePracticeExecution(r.options));
  await act(async () => {
    await result.current.start();
  });
  const id = (start.mock.contexts[0] as StepPracticeController).snapshot()
    .sessionSnapshot!.localSessionId;
  await act(async () => {
    for (const _group of artifact.moments) result.current.skip();
  });
  await waitFor(() => expect(result.current.lifecycle).toBe("COMPLETED"));
  expect(r.completion).toHaveBeenCalledOnce();
  expect(r.health.listenerCount()).toBe(0);
  expect(start).toHaveBeenCalledOnce();
  await act(async () => {
    await Promise.all([result.current.retry(), result.current.retry()]);
  });
  expect(start).toHaveBeenCalledTimes(2);
  expect(
    (start.mock.contexts[1] as StepPracticeController).snapshot()
      .sessionSnapshot!.localSessionId,
  ).not.toBe(id);
  expect(result.current.lifecycle).toBe("ACTIVE");
  unmount();
});
it("unmount during pending Start fences late snapshots and completion", async () => {
  const r = rig();
  let resolve!: () => void;
  r.midi.start.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const start = vi.spyOn(StepPracticeController.prototype, "start");
  const { result, unmount } = renderHook(() => usePracticeExecution(r.options));
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.current.start();
  });
  expect(result.current.lifecycle).toBe("PREPARING");
  const controller = start.mock.contexts[0] as StepPracticeController;
  unmount();
  resolve();
  await act(async () => {
    await pending;
  });
  expect(r.completion).not.toHaveBeenCalled();
  expect(controller.snapshot().state).toBe("DISPOSED");
  expect(r.health.listenerCount()).toBe(0);
});
it("route identity changes serialize retirement; stale completion cannot replace the new view", async () => {
  const r = rig(),
    start = vi.spyOn(StepPracticeController.prototype, "start");
  const { result, rerender, unmount } = renderHook(
    (options) => usePracticeExecution(options),
    { initialProps: r.options },
  );
  await act(async () => {
    await result.current.start();
  });
  const old = start.mock.contexts[0] as StepPracticeController,
    saved = Reflect.get(old, "options").onNaturalCompletion;
  rerender({ ...r.options, compositionId: "score/another" });
  expect(result.current.lifecycle).toBe("READY");
  await act(async () => {
    await result.current.start();
  });
  const before = result.current.executedPlan;
  act(() => saved({ completionReason: "SCOPE_COMPLETED" }));
  expect(r.completion).not.toHaveBeenCalled();
  expect(result.current.executedPlan).toBe(before);
  expect(result.current.lifecycle).toBe("ACTIVE");
  unmount();
});

it("real Continuous completion publishes one handoff through the actor and Retry creates one fresh controller", async () => {
  const r = rig(),
    started = vi.spyOn(ContinuousPracticeController.prototype, "start");
  const { result, unmount } = renderHook(() =>
    usePracticeExecution({
      ...r.options,
      plan: continuousPracticePlan(artifact),
    }),
  );
  await act(async () => {
    await result.current.start();
  });
  const controller = started.mock.contexts[0] as ContinuousPracticeController;
  await act(async () => {
    r.clock.advance(60000);
    controller.refresh();
  });
  await waitFor(() => expect(result.current.lifecycle).toBe("COMPLETED"));
  expect(r.completion).toHaveBeenCalledOnce();
  expect(result.current.completion?.result.session.plan.scope).toEqual(
    result.current.executedPlan?.scope,
  );
  await act(async () => {
    await result.current.retry();
  });
  expect(started).toHaveBeenCalledTimes(2);
  expect(result.current.completion).toBeNull();
  expect(r.health.listenerCount()).toBe(1);
  unmount();
});

it("unmount hard-fences real Continuous FINALIZING before a late completion can hand off", async () => {
  const r = rig(),
    started = vi.spyOn(ContinuousPracticeController.prototype, "start");
  let resolve!: () => void, sealed!: () => void;
  const gate = new Promise<void>((done) => {
      resolve = done;
    }),
    materialized = new Promise<void>((done) => {
      sealed = done;
    });
  const finalize = PerformanceRecorder.prototype.finalize;
  vi.spyOn(PerformanceRecorder.prototype, "finalize").mockImplementationOnce(
    async function (this: PerformanceRecorder) {
      const result = await finalize.call(this);
      sealed();
      await gate;
      return result;
    },
  );
  const { result, unmount } = renderHook(
    () =>
      usePracticeExecution({
        ...r.options,
        plan: continuousPracticePlan(artifact),
      }),
    { wrapper: StrictMode },
  );
  await act(async () => {
    await result.current.start();
  });
  const controller = started.mock.contexts[0] as ContinuousPracticeController;
  act(() => {
    r.clock.advance(60000);
    controller.refresh();
  });
  await materialized;
  expect(controller.snapshot().session).toBe("FINALIZING");
  const dispose = vi.spyOn(controller, "dispose");
  unmount();
  expect(dispose).toHaveBeenCalledOnce();
  resolve();
  await controller.dispose();
  expect(r.completion).not.toHaveBeenCalled();
  expect(r.health.listenerCount()).toBe(0);
});
