import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PracticeExecutionActor,
  type PracticeExecutionFactories,
} from "./practice-execution-actor";
import { StepPracticeController } from "../step/step-practice-controller";
import { ContinuousPracticeController } from "../continuous/continuous-practice-controller";
import { ContinuousPracticeSession } from "../continuous/domain/practice-session";
import type { ContinuousPlatform } from "../continuous/continuous-input";
import { ManualClock } from "../session/timebase";
import {
  continuousPracticePlan,
  stepPracticePlan,
} from "../__fixtures__/practice-plan";
import { artifactWithKeys } from "../__fixtures__/piano-key-artifact";
import { rootHealthFixture } from "../__fixtures__/root-health";
import { borrowedDevices } from "../__fixtures__/device-roots";
import { metronomeAudioFixture } from "../__fixtures__/metronome";
import { recordingSinkFixture } from "../__fixtures__/recording-sink";
import { PerformanceRecorder } from "../recording/performance-recorder";
import {
  createTransientReviewSession,
  releaseTransientReviewSession,
} from "../review/transient-review-session";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function stream(): MediaStream {
  const track = Object.assign(new EventTarget(), {
    kind: "audio",
    readyState: "live",
    muted: false,
    stop: vi.fn(),
  });
  return {
    getTracks: () => [track],
    getAudioTracks: () => [track],
    getVideoTracks: () => [],
    clone: () => stream(),
  } as unknown as MediaStream;
}
class NativeRecorder {
  static isTypeSupported() {
    return true;
  }
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start() {
    this.state = "recording";
  }
  pause() {
    this.state = "paused";
  }
  resume() {
    this.state = "recording";
  }
  requestData() {
    this.ondataavailable?.({ data: new Blob(["recording"]) });
  }
  stop() {
    this.state = "inactive";
    this.onstop?.();
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("MediaRecorder", NativeRecorder);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function continuousRig(mode: "OFF" | "AUDIO" = "OFF", slow = false) {
  const clock = new ManualClock(0),
    health = rootHealthFixture(),
    sink = recordingSinkFixture();
  const gate = deferred(),
    sealed = deferred();
  const recorder = new PerformanceRecorder(mode, sink.open);
  const finalize = recorder.finalize.bind(recorder);
  vi.spyOn(recorder, "finalize").mockImplementation(async () => {
    const recording = await finalize();
    sealed.resolve();
    if (slow) await gate.promise;
    return recording;
  });
  const platform: ContinuousPlatform = {
    midiClock: clock,
    acquireInference: vi.fn(async () => {
      throw new Error("MIDI needs no inference");
    }),
    createAudioContext: vi.fn(() => {
      throw new Error("MIDI needs no analysis context");
    }),
    coefficients: vi.fn(async () => {
      throw new Error("MIDI needs no coefficients");
    }),
    workletUrl: "unused",
    connectCapture: vi.fn(async () => {
      throw new Error("MIDI needs no capture");
    }),
    createMidi: () => ({
      start: async () => {},
      dispose: vi.fn(),
      refreshInputs: vi.fn(),
    }),
    createRecorder: () => recorder,
    createMetronomeAudio: () => metronomeAudioFixture(),
  };
  let leaf!: ContinuousPracticeController;
  const factories: PracticeExecutionFactories = {
    step: () => {
      throw new Error("Continuous only");
    },
    continuous: (options) => {
      leaf = new ContinuousPracticeController(options, platform);
      return leaf;
    },
  };
  const actor = new PracticeExecutionActor(
    {
      borrowRoots: () =>
        borrowedDevices(null, mode === "AUDIO" ? stream() : null),
      rootHealth: health.port,
    },
    factories,
  );
  const plan = continuousPracticePlan(artifactWithKeys([[60]]), {
    recordingMode: mode,
    tempoSelection: { mode: "CUSTOM_FIXED_BPM", bpm: 120 },
  });
  actor.setCandidate(plan, true, "composition");
  const listener = vi.fn(() =>
    expect(actor.snapshot().lifecycle).toBe("COMPLETED"),
  );
  actor.setCompletionListener(listener);
  return {
    actor,
    clock,
    plan,
    listener,
    recorder,
    sink,
    gate,
    sealed,
    leaf: () => leaf,
    running() {
      clock.set(leaf.snapshot().transport!.countInRemainingMs);
      leaf.refresh();
      expect(leaf.snapshot().transport?.state).toBe("RUNNING");
    },
    latch() {
      clock.set(leaf.snapshot().transport!.countInRemainingMs);
      leaf.refresh();
      expect(leaf.snapshot().transport?.state).toBe("RUNNING");
      clock.set(10000);
      leaf.refresh();
      expect(leaf.snapshot().session).toBe("FINALIZING");
    },
  };
}

describe("real leaf retirement arbitration", () => {
  it("real STEP last-target commit wins End while natural cleanup is still pending", async () => {
    const clock = new ManualClock(100),
      health = rootHealthFixture();
    let leaf!: StepPracticeController;
    const actor = new PracticeExecutionActor(
      { borrowRoots: () => borrowedDevices(), rootHealth: health.port },
      {
        continuous: () => {
          throw new Error("STEP only");
        },
        step: (options) => {
          leaf = new StepPracticeController({
            ...options,
            platform: {
              clock,
              timer: { schedule: vi.fn(), cancel: vi.fn() },
              createMidi: () => ({
                start: async () => {},
                refreshInputs: vi.fn(),
                dispose: vi.fn(),
              }),
              createMetronomeAudio: () => metronomeAudioFixture(),
            },
          });
          return leaf;
        },
      },
    );
    actor.setCandidate(
      stepPracticePlan(artifactWithKeys([[60]])),
      true,
      "composition",
    );
    const listener = vi.fn(() =>
      expect(actor.snapshot().lifecycle).toBe("COMPLETED"),
    );
    actor.setCompletionListener(listener);
    await actor.start();
    const dispose = vi.spyOn(leaf, "dispose");
    actor.skip(); // Real final target commits SCOPE_COMPLETED; cleanup awaits its resource retirement.
    expect(leaf.snapshot().sessionSnapshot?.completionReason).toBe(
      "SCOPE_COMPLETED",
    );
    expect(listener).not.toHaveBeenCalled();
    const ending = actor.end();
    expect(dispose).not.toHaveBeenCalled();
    await ending;
    expect(actor.snapshot().lifecycle).toBe("COMPLETED");
    expect(listener).toHaveBeenCalledOnce();
    expect(dispose).not.toHaveBeenCalled();
    await actor.end();
    expect(actor.snapshot().lifecycle).toBe("COMPLETED");
    await actor.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });
  it("real Continuous recording OFF formal latch wins End before finalization callback", async () => {
    const r = continuousRig();
    await r.actor.start();
    const dispose = vi.spyOn(r.leaf(), "dispose");
    r.latch();
    expect(r.listener).not.toHaveBeenCalled();
    await r.actor.end();
    expect(r.actor.snapshot()).toMatchObject({
      lifecycle: "COMPLETED",
      completion: { recording: { status: "NOT_RECORDED" } },
    });
    expect(r.listener).toHaveBeenCalledOnce();
    expect(dispose).not.toHaveBeenCalled();
    await r.actor.dispose();
  });
  it("real slow finalization survives End and retains READY media until Review owners retire", async () => {
    const r = continuousRig("AUDIO", true);
    await r.actor.start();
    const dispose = vi.spyOn(r.leaf(), "dispose");
    r.latch();
    await r.sealed.promise;
    let ended = false;
    const ending = r.actor.end().then(() => {
      ended = true;
    });
    await Promise.resolve();
    expect(ended).toBe(false);
    expect(dispose).not.toHaveBeenCalled();
    expect(r.sink.remove).not.toHaveBeenCalled();
    r.gate.resolve();
    await ending;
    const completion = r.actor.snapshot().completion!;
    expect(completion.recording.status).toBe("READY");
    expect(r.listener).toHaveBeenCalledOnce();
    expect(dispose).not.toHaveBeenCalled();
    expect(r.sink.remove).not.toHaveBeenCalled();
    const review = createTransientReviewSession(completion, {
      ...r.plan.source,
      musicXml: "<score-partwise/>",
    });
    await r.actor.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    expect(r.sink.remove).not.toHaveBeenCalled();
    await releaseTransientReviewSession(review);
    await releaseTransientReviewSession(review);
    expect(r.sink.remove).toHaveBeenCalledOnce();
  });
  it("End before formal latch abandons despite elapsed wall clock and never advances semantic time", async () => {
    const r = continuousRig();
    await r.actor.start();
    r.running();
    const advance = vi.spyOn(
      ContinuousPracticeSession.prototype,
      "advanceToNow",
    );
    r.clock.set(10000); // Nominal terminal elapsed, but no refresh / evidence transition latched it.
    await r.actor.end();
    expect(advance).not.toHaveBeenCalled();
    expect(r.actor.snapshot()).toMatchObject({
      lifecycle: "READY",
      completion: null,
      executedPlan: null,
    });
    expect(r.listener).not.toHaveBeenCalled();
    await r.actor.dispose();
  });
  it.each(["DISPOSE", "REPLACEMENT", "ADMISSION"] as const)(
    "%s during slow END retirement hard-disposes and releases unpublished media exactly once",
    async (reason) => {
      const r = continuousRig("AUDIO", true);
      await r.actor.start();
      const dispose = vi.spyOn(r.leaf(), "dispose");
      r.latch();
      await r.sealed.promise;
      const ending = r.actor.end();
      let teardown: Promise<void> | undefined;
      if (reason === "DISPOSE") teardown = r.actor.dispose();
      else
        r.actor.setCandidate(
          reason === "ADMISSION" ? null : r.plan,
          reason === "REPLACEMENT",
          reason === "REPLACEMENT" ? "replacement" : "composition",
        );
      expect(dispose).toHaveBeenCalledOnce();
      r.gate.resolve();
      await ending;
      await teardown;
      expect(r.actor.snapshot().completion).toBeNull();
      expect(r.listener).not.toHaveBeenCalled();
      expect(r.sink.remove).toHaveBeenCalledOnce();
      await r.actor.dispose();
      expect(dispose).toHaveBeenCalledOnce();
    },
  );
});
