import { afterEach, describe, expect, it, vi } from 'vitest';

import canonicalArtifactJson from '../local-core/__fixtures__/canonical-practice-score-artifact.json';
import {
  ManualClock,
  PerformancePracticeRuntime,
  PracticeTimebase,
  StepPracticeRuntime,
  type PracticeScoreArtifact,
  type StepVerifierObservation,
} from '../local-core';
import {
  BoundedPcmSampleRing,
  buildLiveFixedAnchorWindow,
  BrowserMicrophoneCaptureController,
  BYTEDANCE_ROLLING_ANCHOR_STEP_SAMPLES,
  createLiveCaptureTimebase,
  defaultByteDanceModelManifest,
  LiveByteDanceRollingPipeline,
  monoFromChannels,
  RollingInferenceScheduler,
  StreamingLinearResampler,
  type ByteDanceBrowserWorkerClient,
  type ByteDanceInferenceResult,
  type ByteDanceModelManifest,
  type ByteDancePcmInferenceRequest,
  type AcousticNoteEvent,
  type LiveByteDanceControllerOptions,
} from './index';

const artifact = canonicalArtifactJson as PracticeScoreArtifact;

function manifest(): ByteDanceModelManifest {
  return defaultByteDanceModelManifest({
    modelUrl: '/models/bytedance/bytedance_note_model_fixed_anchor.onnx',
    expectedByteSize: 98_691_493,
    sha256: '6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5',
  });
}

class FakeWorker implements Pick<ByteDanceBrowserWorkerClient, 'load' | 'infer' | 'dispose' | 'terminate'> {
  loadCount = 0;
  disposeCount = 0;
  terminateCount = 0;
  requests: ByteDancePcmInferenceRequest[] = [];
  loadImpl: () => Promise<undefined> = async () => undefined;
  disposeImpl: () => Promise<void> = async () => undefined;
  inferImpl: (request: ByteDancePcmInferenceRequest) => Promise<ByteDanceInferenceResult>
    = async (request) => ({ requestId: request.requestId, events: [] });

  async load(): Promise<undefined> {
    this.loadCount += 1;
    return this.loadImpl();
  }

  async infer(request: ByteDancePcmInferenceRequest): Promise<ByteDanceInferenceResult> {
    this.requests.push(request);
    return this.inferImpl(request);
  }

  async dispose(): Promise<void> {
    this.disposeCount += 1;
    return this.disposeImpl();
  }

  terminate(): void {
    this.terminateCount += 1;
  }
}

function workerCast(worker: FakeWorker): ByteDanceBrowserWorkerClient {
  return worker as unknown as ByteDanceBrowserWorkerClient;
}

function event(input: {
  pitch: string;
  midiPitch: number;
  sampleIndex: number;
  timebase: PracticeTimebase;
  inferenceCompletedAtMs?: number;
}): AcousticNoteEvent {
  return {
    pitch: input.pitch,
    midiPitch: input.midiPitch,
    onsetTime: input.timebase.sampleIndexToSessionTime(input.sampleIndex),
    confidence: 0.9,
    onsetScore: 0.9,
    frameScore: 0.9,
    source: 'ACOUSTIC',
    inferenceCompletedAtMs: input.inferenceCompletedAtMs,
  };
}

function fill(length: number, value = 0.25): Float32Array {
  return Float32Array.from({ length }, () => value);
}

function anchor(domainId = 'capture-domain', ms = 0, sampleIndex = 0) {
  return { domainId, ms, sampleIndex };
}

function pipelineOptions(
  overrides: Partial<LiveByteDanceControllerOptions> = {}
): LiveByteDanceControllerOptions {
  return {
    manifest: manifest(),
    sessionTimebase: new PracticeTimebase({ domainId: 'capture-domain', sampleRateHz: 16_000 }),
    sourceSampleRateHz: 48_000,
    captureSessionAnchor: () => anchor(),
    ...overrides,
  };
}

async function tick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function settleAsyncWork(): Promise<void> {
  await tick();
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

type FakeBrowserAudioEnvironment = {
  trackStop: ReturnType<typeof vi.fn>;
  sourceDisconnect: ReturnType<typeof vi.fn>;
  workletDisconnect: ReturnType<typeof vi.fn>;
  portClose: ReturnType<typeof vi.fn>;
  sinkDisconnect: ReturnType<typeof vi.fn>;
  audioClose: ReturnType<typeof vi.fn>;
  workletModuleLoad: ReturnType<typeof vi.fn>;
  worklet?: {
    port: { onmessage?: (event: { data: unknown }) => void };
    listeners?: Record<string, ((event: Event) => void)[]>;
  };
};

function installFakeBrowserAudioEnvironment(): FakeBrowserAudioEnvironment {
  const env: FakeBrowserAudioEnvironment = {
    trackStop: vi.fn(),
    sourceDisconnect: vi.fn(),
    workletDisconnect: vi.fn(),
    portClose: vi.fn(),
    sinkDisconnect: vi.fn(),
    audioClose: vi.fn().mockResolvedValue(undefined),
    workletModuleLoad: vi.fn().mockResolvedValue(undefined),
  };
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [{ stop: env.trackStop }],
      }),
    },
  });
  class FakeAudioContext {
    sampleRate = 48_000;
    destination = {};
    audioWorklet = {
      addModule: env.workletModuleLoad,
    };
    createMediaStreamSource = vi.fn().mockReturnValue({
      connect: vi.fn(),
      disconnect: env.sourceDisconnect,
    });
    createGain = vi.fn().mockReturnValue({
      gain: { value: 1 },
      connect: vi.fn(),
      disconnect: env.sinkDisconnect,
    });
    close = env.audioClose;
  }
  class FakeAudioWorkletNode {
    port = {
      close: env.portClose,
      onmessage: undefined as ((event: { data: unknown }) => void) | undefined,
    };
    connect = vi.fn();
    disconnect = env.workletDisconnect;
    listeners: Record<string, ((event: Event) => void)[]> = {};
    addEventListener = vi.fn((type: string, listener: (event: Event) => void) => {
      (this.listeners[type] ??= []).push(listener);
    });

    constructor() {
      env.worklet = this;
    }
  }
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
  return env;
}

describe('live ByteDance capture primitives', () => {
  it('converts multi-channel chunks to deterministic mono', () => {
    expect(Array.from(monoFromChannels([
      Float32Array.from([1, 0.5, -1]),
      Float32Array.from([0, -0.5, 1]),
    ]))).toEqual([0.5, 0, 0]);
  });

  it('preserves streaming resampler continuity for 48 kHz and 44.1 kHz chunks', () => {
    const resample48 = new StreamingLinearResampler(48_000);
    const first48 = resample48.append({ samples: fill(480, 0.1), sourceStartSampleIndex: 0 });
    const second48 = resample48.append({ samples: fill(480, 0.2), sourceStartSampleIndex: 480 });
    expect(first48.startSampleIndex).toBe(0);
    expect(second48.startSampleIndex).toBe(first48.endSampleIndex);
    expect(second48.endSampleIndex).toBeGreaterThan(second48.startSampleIndex);

    const resample441 = new StreamingLinearResampler(44_100);
    const first441 = resample441.append({ samples: fill(441), sourceStartSampleIndex: 0 });
    const second441 = resample441.append({ samples: fill(441), sourceStartSampleIndex: 441 });
    expect(first441.startSampleIndex).toBe(0);
    expect(second441.startSampleIndex).toBe(first441.endSampleIndex);
    expect(second441.endSampleIndex - first441.startSampleIndex).toBeGreaterThanOrEqual(318);
    expect(second441.endSampleIndex - first441.startSampleIndex).toBeLessThanOrEqual(320);
  });

  it('rejects source gaps instead of resetting resampler phase per chunk', () => {
    const resampler = new StreamingLinearResampler(48_000);
    resampler.append({ samples: fill(128), sourceStartSampleIndex: 0 });
    expect(() => resampler.append({ samples: fill(128), sourceStartSampleIndex: 129 }))
      .toThrow(/contiguous source samples/);
  });

  it('extracts absolute ranges from a bounded PCM ring and reports trimmed ranges', () => {
    const ring = new BoundedPcmSampleRing(8);
    ring.append(Float32Array.from([1, 2, 3, 4]), 0);
    expect(Array.from(ring.extractRange(1, 3))).toEqual([2, 3]);
    ring.append(Float32Array.from([5, 6, 7, 8, 9]), 4);
    expect(ring.startSampleIndex).toBe(1);
    expect(ring.endSampleIndex).toBe(9);
    expect(() => ring.extractRange(0, 2)).toThrow(/not present/);
  });

  it('assembles fixed-anchor windows with left padding and real future context only', () => {
    const ring = new BoundedPcmSampleRing(40_000);
    ring.append(fill(3520), 0);
    const early = buildLiveFixedAnchorWindow({ ring, anchorSampleIndex: 0 });
    expect(early.pcm.length).toBe(29_120);
    expect(early.leftPaddingSamples).toBe(25_600);
    expect(early.realStartSampleIndex).toBe(0);
    expect(early.realEndSampleIndex).toBe(3520);

    const missingFuture = new BoundedPcmSampleRing(40_000);
    missingFuture.append(fill(3519), 0);
    expect(() => buildLiveFixedAnchorWindow({ ring: missingFuture, anchorSampleIndex: 0 }))
      .toThrow(/future context/);
    expect(() => buildLiveFixedAnchorWindow({ ring: missingFuture, anchorSampleIndex: 10_000 }))
      .toThrow(/future context|beyond captured/);
  });

  it('uses a 2400-sample grid with one active inference and latest-ready coalescing', () => {
    const scheduler = new RollingInferenceScheduler();
    expect(scheduler.nextReadyAnchor(3519)).toBeNull();
    expect(scheduler.nextReadyAnchor(3520)).toBe(0);
    scheduler.markStarted(0);
    expect(scheduler.nextReadyAnchor(3520 + BYTEDANCE_ROLLING_ANCHOR_STEP_SAMPLES)).toBeNull();
    expect(scheduler.pendingAnchorSampleIndex).toBe(2400);
    expect(scheduler.nextReadyAnchor(3520 + BYTEDANCE_ROLLING_ANCHOR_STEP_SAMPLES * 3)).toBeNull();
    expect(scheduler.pendingAnchorSampleIndex).toBe(7200);
    expect(scheduler.markCompleted()).toBe(7200);
  });

  it('maps non-zero sample anchors into one explicit PracticeTimebase domain', () => {
    const timebase = createLiveCaptureTimebase({
      captureDomainId: 'capture-a',
      anchorSampleIndex: 10_000,
      anchorSessionTime: { domainId: 'capture-a', ms: 5000, sampleIndex: 10_000 },
    });
    expect(timebase.sampleIndexToSessionTime(10_000)).toEqual({
      domainId: 'capture-a',
      ms: 5000,
      sampleIndex: 10_000,
    });
    expect(timebase.sampleIndexToSessionTime(10_800).ms).toBe(5050);
  });
});

describe('live ByteDance rolling pipeline', () => {
  it('deduplicates one physical onset repeated by overlapping inference windows', async () => {
    const timebase = new PracticeTimebase({ domainId: 'capture-1', sampleRateHz: 16_000 });
    const worker = new FakeWorker();
    const received: AcousticNoteEvent[][] = [];
    worker.inferImpl = async (request) => ({
      requestId: request.requestId,
      events: [event({ pitch: 'C4', midiPitch: 60, sampleIndex: 1600, timebase })],
    });
    const pipeline = new LiveByteDanceRollingPipeline({
      ...pipelineOptions({
        sessionTimebase: timebase,
        workerClient: workerCast(worker),
        evidenceSink: { onAcousticEvents: (events) => received.push([...events]) },
      }),
    });
    await pipeline.start();
    pipeline.appendNormalizedPcm(fill(3520), 0);
    await tick();
    pipeline.appendNormalizedPcm(fill(2400), 3520);
    await tick();
    expect(worker.requests.map((request) => request.captureStartSampleIndex)).toEqual([-25_600, -23_200]);
    expect(received.flat().map((item) => item.pitch)).toEqual(['C4']);
  });

  it('emits a real same-pitch retrigger after the 50 ms dedupe boundary', async () => {
    const timebase = new PracticeTimebase({ domainId: 'capture-2', sampleRateHz: 16_000 });
    const worker = new FakeWorker();
    const emitted: AcousticNoteEvent[] = [];
    worker.inferImpl = async (request) => ({
      requestId: request.requestId,
      events: [
        event({ pitch: 'C4', midiPitch: 60, sampleIndex: 1600, timebase }),
        event({ pitch: 'C4', midiPitch: 60, sampleIndex: 1600 + 801, timebase }),
      ],
    });
    const pipeline = new LiveByteDanceRollingPipeline({
      ...pipelineOptions({
        sessionTimebase: timebase,
        workerClient: workerCast(worker),
        evidenceSink: { onAcousticEvents: (events) => emitted.push(...events) },
      }),
    });
    await pipeline.start();
    pipeline.appendNormalizedPcm(fill(3520), 0);
    await tick();
    expect(emitted.map((item) => item.onsetTime.sampleIndex)).toEqual([1600, 2401]);
  });

  it('ignores late worker results after stop or capture-domain replacement', async () => {
    const timebase = new PracticeTimebase({ domainId: 'capture-3', sampleRateHz: 16_000 });
    const worker = new FakeWorker();
    const pending: { resolve?: (result: ByteDanceInferenceResult) => void } = {};
    const emitted: AcousticNoteEvent[] = [];
    worker.inferImpl = async () => new Promise((resolve) => {
      pending.resolve = resolve;
    });
    const pipeline = new LiveByteDanceRollingPipeline({
      ...pipelineOptions({
        sessionTimebase: timebase,
        workerClient: workerCast(worker),
        evidenceSink: { onAcousticEvents: (events) => emitted.push(...events) },
      }),
    });
    await pipeline.start();
    pipeline.appendNormalizedPcm(fill(3520), 0);
    await pipeline.stop();
    if (pending.resolve) {
      pending.resolve({
        requestId: 'late',
        events: [event({ pitch: 'C4', midiPitch: 60, sampleIndex: 1600, timebase })],
      });
    }
    await tick();
    expect(emitted).toEqual([]);
  });

  it('routes fresh STEP chord evidence through the existing adapter and rejects stale or partial evidence', async () => {
    const clock = new ManualClock(0);
    const runtime = new StepPracticeRuntime({
      artifact,
      clock,
      scope: {
        startGroupId: artifact.expectedPracticeGroups[3].groupId,
        endGroupId: artifact.expectedPracticeGroups[3].groupId,
      },
    });
    const target = runtime.currentTarget();
    expect(target?.attackPitches).toEqual(['A4', 'C5']);
    const timebase = new PracticeTimebase({ domainId: target?.activationBoundary.domainId ?? 'step', sampleRateHz: 16_000 });
    const worker = new FakeWorker();
    worker.inferImpl = async (request) => ({
      requestId: request.requestId,
      events: [
        event({ pitch: 'C4', midiPitch: 60, sampleIndex: -100, timebase }),
        event({ pitch: 'A4', midiPitch: 69, sampleIndex: 1600, timebase }),
        event({ pitch: 'C5', midiPitch: 72, sampleIndex: 1650, timebase }),
      ],
    });
    const matches: StepVerifierObservation[] = [];
    const pipeline = new LiveByteDanceRollingPipeline({
      ...pipelineOptions({
        sessionTimebase: timebase,
        workerClient: workerCast(worker),
        evidenceSink: {
          currentStepTarget: () => runtime.currentTarget(),
          onStepObservation: (observation) => {
            matches.push(observation);
            runtime.observe(observation);
          },
        },
      }),
    });
    await pipeline.start();
    pipeline.appendNormalizedPcm(fill(3520), 0);
    await tick();
    expect(matches).toHaveLength(1);
    expect(matches[0].observedAttackPitches).toEqual(['A4', 'C5']);
    expect(runtime.isCompleted).toBe(true);
  });

  it('does not let an old inference result after STEP advance satisfy the next repeated pitch', async () => {
    const clock = new ManualClock(0);
    const runtime = new StepPracticeRuntime({ artifact, clock });
    const first = runtime.currentTarget();
    expect(first?.attackPitches).toEqual(['C4']);
    const timebase = new PracticeTimebase({ domainId: first?.activationBoundary.domainId ?? 'step', sampleRateHz: 16_000 });
    const firstObservation = {
      stepId: first!.stepId,
      activationGeneration: first!.activationGeneration,
      attackOnsetTime: timebase.sampleIndexToSessionTime(1600),
      captureTime: timebase.sampleIndexToSessionTime(1600),
      observedAttackPitches: ['C4'],
      confidence: 0.9,
      source: 'ACOUSTIC' as const,
    };
    clock.set(200);
    runtime.observe(firstObservation);
    const second = runtime.currentTarget();
    expect(second?.attackPitches).toEqual(['C4']);
    const worker = new FakeWorker();
    const observations: StepVerifierObservation[] = [];
    worker.inferImpl = async (request) => ({
      requestId: request.requestId,
      events: [event({ pitch: 'C4', midiPitch: 60, sampleIndex: 1600, timebase })],
    });
    const pipeline = new LiveByteDanceRollingPipeline({
      ...pipelineOptions({
        sessionTimebase: timebase,
        workerClient: workerCast(worker),
        evidenceSink: {
          currentStepTarget: () => runtime.currentTarget(),
          onStepObservation: (observation) => observations.push(observation),
        },
      }),
    });
    await pipeline.start();
    pipeline.appendNormalizedPcm(fill(3520), 0);
    await tick();
    expect(observations).toEqual([]);
  });

  it('feeds CONTINUOUS with capture-timed evidence without moving the performance clock or duplicating overlaps', async () => {
    const clock = new ManualClock(0);
    const performance = new PerformancePracticeRuntime({
      artifact,
      clock,
      countInBeats: 0,
      localSessionId: 'perf-capture',
    });
    performance.start();
    const before = performance.snapshot().musicalBeat;
    const timebase = new PracticeTimebase({ domainId: 'perf-capture', sampleRateHz: 16_000 });
    const worker = new FakeWorker();
    worker.inferImpl = async (request) => ({
      requestId: request.requestId,
      events: [
        event({
          pitch: 'C4',
          midiPitch: 60,
          sampleIndex: 1600,
          timebase,
          inferenceCompletedAtMs: 10_000,
        }),
      ],
    });
    const observations: unknown[] = [];
    const pipeline = new LiveByteDanceRollingPipeline({
      ...pipelineOptions({
        sessionTimebase: timebase,
        workerClient: workerCast(worker),
        evidenceSink: {
          onPerformanceEvidence: (items) => {
            observations.push(...items.map((item) => performance.observeEvidence(item)));
          },
        },
      }),
    });
    await pipeline.start();
    pipeline.appendNormalizedPcm(fill(3520), 0);
    await tick();
    pipeline.appendNormalizedPcm(fill(2400), 3520);
    await tick();
    expect(observations).toHaveLength(1);
    expect(performance.snapshot().musicalBeat).toBe(before);
  });

  it('stops during active inference, terminates the Worker, and restarts with a fresh Worker', async () => {
    const workers = [new FakeWorker(), new FakeWorker()];
    const pending: { resolve?: (result: ByteDanceInferenceResult) => void } = {};
    workers[0].disposeImpl = async () => {
      throw new Error('ByteDance worker cannot DISPOSE while inference is active.');
    };
    workers[0].inferImpl = async () => new Promise((resolve) => {
      pending.resolve = resolve;
    });
    workers[1].inferImpl = async (request) => ({ requestId: request.requestId, events: [] });
    let index = 0;
    const pipeline = new LiveByteDanceRollingPipeline(pipelineOptions({
      workerClientFactory: () => workerCast(workers[index++]),
    }));

    await pipeline.start();
    pipeline.appendNormalizedPcm(fill(3520), 0);
    await pipeline.stop();
    expect(workers[0].terminateCount).toBe(1);

    await pipeline.start();
    pipeline.appendNormalizedPcm(fill(3520), 0);
    await tick();
    expect(workers[1].loadCount).toBe(1);
    expect(workers[1].requests).toHaveLength(1);
    expect(pipeline.snapshot().state).toBe('running');

    pending.resolve?.({ requestId: 'old', events: [] });
    await tick();
  });

  it('cleans up startup load failures, preserves error state, and retries with a fresh Worker', async () => {
    const workers = [new FakeWorker(), new FakeWorker()];
    workers[0].loadImpl = async () => {
      throw new Error('model load failed');
    };
    let index = 0;
    const pipeline = new LiveByteDanceRollingPipeline(pipelineOptions({
      workerClientFactory: () => workerCast(workers[index++]),
    }));

    await expect(pipeline.start()).rejects.toThrow(/model load failed/);
    expect(pipeline.snapshot()).toMatchObject({
      state: 'error',
      lastError: 'model load failed',
    });
    expect(workers[0].disposeCount).toBe(1);

    await pipeline.start();
    expect(workers[1].loadCount).toBe(1);
    expect(pipeline.snapshot().state).toBe('running');
  });

  it('makes fixed workerClient one-lifecycle only so restartable paths use a factory', async () => {
    const worker = new FakeWorker();
    const pipeline = new LiveByteDanceRollingPipeline(pipelineOptions({
      workerClient: workerCast(worker),
    }));
    await pipeline.start();
    await pipeline.stop();
    await expect(pipeline.start()).rejects.toThrow(/workerClient can only be used for one capture lifecycle/);
  });

  it('does not submit a pending coalesced anchor after inference failure', async () => {
    const worker = new FakeWorker();
    const pending: { reject?: (error: Error) => void } = {};
    worker.inferImpl = async () => new Promise((_, reject) => {
      pending.reject = reject;
    });
    const pipeline = new LiveByteDanceRollingPipeline(pipelineOptions({
      workerClient: workerCast(worker),
    }));

    await pipeline.start();
    pipeline.appendNormalizedPcm(fill(3520), 0);
    pipeline.appendNormalizedPcm(fill(2400 * 3), 3520);
    expect(pipeline.snapshot().coalescedAnchorSampleIndex).toBe(7200);
    pending.reject?.(new Error('inference failed'));
    await settleAsyncWork();

    expect(pipeline.snapshot()).toMatchObject({
      state: 'error',
      lastError: 'inference failed',
    });
    expect(worker.requests).toHaveLength(1);
  });

  it('restarts capture with later session time and no sample/time rewind', async () => {
    const anchors = [
      anchor('stable-practice-domain', 0, 0),
      anchor('stable-practice-domain', 5000, 80_000),
    ];
    const emitted: AcousticNoteEvent[] = [];
    const workers = [new FakeWorker(), new FakeWorker()];
    for (const worker of workers) {
      worker.inferImpl = async (request) => ({
        requestId: request.requestId,
        events: [{
          pitch: 'C4',
          midiPitch: 60,
          onsetTime: {
            ...request.captureStartTime,
            ms: request.captureStartTime.ms + 1600,
            sampleIndex: request.captureStartSampleIndex + 25_600,
          },
          confidence: 0.9,
          onsetScore: 0.9,
          frameScore: 0.9,
          source: 'ACOUSTIC',
        }],
      });
    }
    let workerIndex = 0;
    let anchorIndex = 0;
    const pipeline = new LiveByteDanceRollingPipeline(pipelineOptions({
      sessionTimebase: new PracticeTimebase({ domainId: 'stable-practice-domain', sampleRateHz: 16_000 }),
      workerClientFactory: () => workerCast(workers[workerIndex++]),
      captureSessionAnchor: () => anchors[anchorIndex++],
      evidenceSink: { onAcousticEvents: (events) => emitted.push(...events) },
    }));

    await pipeline.start();
    expect(pipeline.currentLifecycleStartSampleIndex).toBe(0);
    pipeline.appendNormalizedPcm(fill(3520), 0);
    await tick();
    await pipeline.stop();

    await pipeline.start();
    expect(pipeline.currentLifecycleStartSampleIndex).toBe(80_000);
    pipeline.appendNormalizedPcm(fill(5120), 80_000);
    await tick();

    expect(emitted).toHaveLength(2);
    expect(emitted[0].onsetTime.domainId).toBe('stable-practice-domain');
    expect(emitted[1].onsetTime.domainId).toBe('stable-practice-domain');
    expect(emitted[1].onsetTime.sampleIndex).toBeGreaterThan(emitted[0].onsetTime.sampleIndex ?? 0);
    expect(emitted[1].onsetTime.ms).toBeGreaterThan(emitted[0].onsetTime.ms);
  });

  it('ignores old results after restart and resets normalizer state per lifecycle', async () => {
    const workers = [new FakeWorker(), new FakeWorker()];
    const pending: { resolve?: (result: ByteDanceInferenceResult) => void } = {};
    const emitted: AcousticNoteEvent[] = [];
    workers[0].disposeImpl = async () => {
      throw new Error('ByteDance worker cannot DISPOSE while inference is active.');
    };
    workers[0].inferImpl = async () => new Promise((resolve) => {
      pending.resolve = resolve;
    });
    workers[1].inferImpl = async (request) => ({
      requestId: request.requestId,
      events: [event({
        pitch: 'C4',
        midiPitch: 60,
        sampleIndex: request.captureStartSampleIndex + 25_600,
        timebase: createLiveCaptureTimebase({
          captureDomainId: 'capture-domain',
          anchorSampleIndex: 0,
          anchorSessionTime: anchor(),
        }),
      })],
    });
    let index = 0;
    const pipeline = new LiveByteDanceRollingPipeline(pipelineOptions({
      workerClientFactory: () => workerCast(workers[index++]),
      evidenceSink: { onAcousticEvents: (events) => emitted.push(...events) },
    }));
    await pipeline.start();
    pipeline.appendNormalizedPcm(fill(3520), 0);
    await pipeline.stop();
    await pipeline.start();
    pipeline.appendNormalizedPcm(fill(3520), 0);
    pending.resolve?.({
      requestId: 'late-old',
      events: [event({
        pitch: 'C4',
        midiPitch: 60,
        sampleIndex: 0,
        timebase: createLiveCaptureTimebase({
          captureDomainId: 'capture-domain',
          anchorSampleIndex: 0,
          anchorSessionTime: anchor(),
        }),
      })],
    });
    await tick();
    expect(emitted).toHaveLength(1);
  });

  it('keeps BrowserMicrophoneCaptureController permission and AudioWorklet errors observable', async () => {
    const denied = new Error('permission denied');
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockRejectedValue(denied),
      },
    });
    const permissionController = new BrowserMicrophoneCaptureController(pipelineOptions());
    await expect(permissionController.start()).rejects.toThrow(/permission denied/);
    expect(permissionController.snapshot()).toMatchObject({
      state: 'error',
      lastError: 'permission denied',
    });

    const stream = { getTracks: () => [{ stop: vi.fn() }] };
    class FailingAudioContext {
      sampleRate = 48_000;
      destination = {};
      audioWorklet = {
        addModule: vi.fn().mockRejectedValue(new Error('worklet failed')),
      };
      createMediaStreamSource = vi.fn();
      close = vi.fn().mockResolvedValue(undefined);
    }
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue(stream),
      },
    });
    vi.stubGlobal('AudioContext', FailingAudioContext);
    const workletController = new BrowserMicrophoneCaptureController(pipelineOptions());
    await expect(workletController.start()).rejects.toThrow(/worklet failed/);
    expect(workletController.snapshot()).toMatchObject({
      state: 'error',
      lastError: 'worklet failed',
    });
  });

  it('propagates pipeline runtime failure to controller resource cleanup and preserves error state', async () => {
    const env = installFakeBrowserAudioEnvironment();
    const worker = new FakeWorker();
    const workers = [worker, new FakeWorker()];
    let workerIndex = 0;
    worker.inferImpl = async () => {
      throw new Error('runtime inference failed');
    };
    const controller = new BrowserMicrophoneCaptureController(pipelineOptions({
      workerClientFactory: () => workerCast(workers[workerIndex++]),
    }));
    await controller.start();
    env.worklet?.port.onmessage?.({
      data: {
        type: 'pcm-chunk',
        sourceSampleRateHz: 48_000,
        sourceStartSampleIndex: 0,
        sourceEndSampleIndex: 10_560,
        samples: fill(10_560),
      },
    });
    await settleAsyncWork();

    expect(controller.snapshot()).toMatchObject({
      state: 'error',
      lastError: 'runtime inference failed',
    });
    expect(env.trackStop).toHaveBeenCalledTimes(1);
    expect(env.portClose).toHaveBeenCalledTimes(1);
    expect(env.workletDisconnect).toHaveBeenCalledTimes(1);
    expect(env.sinkDisconnect).toHaveBeenCalledTimes(1);
    expect(env.sourceDisconnect).toHaveBeenCalledTimes(1);
    expect(env.audioClose).toHaveBeenCalledTimes(1);

    await controller.start();
    expect(workers[1].loadCount).toBe(1);
    expect(controller.snapshot().state).toBe('running');
  });

  it('turns synchronous Worklet message processing failures into one fatal cleanup', async () => {
    const env = installFakeBrowserAudioEnvironment();
    const worker = new FakeWorker();
    const controller = new BrowserMicrophoneCaptureController(pipelineOptions({
      workerClient: workerCast(worker),
    }));
    await controller.start();
    env.worklet?.port.onmessage?.({
      data: {
        type: 'pcm-chunk',
        sourceSampleRateHz: 48_000,
        sourceStartSampleIndex: 0,
        sourceEndSampleIndex: 128,
        samples: fill(128),
      },
    });
    env.worklet?.port.onmessage?.({
      data: {
        type: 'pcm-chunk',
        sourceSampleRateHz: 48_000,
        sourceStartSampleIndex: 129,
        sourceEndSampleIndex: 257,
        samples: fill(128),
      },
    });
    await settleAsyncWork();
    env.worklet?.port.onmessage?.({
      data: {
        type: 'pcm-chunk',
        sourceSampleRateHz: 48_000,
        sourceStartSampleIndex: 257,
        sourceEndSampleIndex: 385,
        samples: fill(128),
      },
    });
    await settleAsyncWork();

    expect(controller.snapshot()).toMatchObject({
      state: 'error',
      lastError: expect.stringContaining('contiguous source samples'),
    });
    expect(env.trackStop).toHaveBeenCalledTimes(1);
    expect(env.portClose).toHaveBeenCalledTimes(1);
    expect(worker.requests).toHaveLength(0);
  });

  it('rejects repeated start() while controller is already running', async () => {
    installFakeBrowserAudioEnvironment();
    const controller = new BrowserMicrophoneCaptureController(pipelineOptions({
      workerClient: workerCast(new FakeWorker()),
    }));
    await controller.start();
    await expect(controller.start()).rejects.toThrow(/already in 'running'/);
    expect(controller.snapshot().state).toBe('running');
    await controller.stop();
  });

  it('cleans up Worker model load failure exactly once at controller level and retries with factory', async () => {
    const env = installFakeBrowserAudioEnvironment();
    const failingWorker = new FakeWorker();
    failingWorker.loadImpl = async () => {
      throw new Error('model load OOM');
    };
    const freshWorker = new FakeWorker();
    const workers = [failingWorker, freshWorker];
    let workerIndex = 0;
    const controller = new BrowserMicrophoneCaptureController(pipelineOptions({
      workerClientFactory: () => workerCast(workers[workerIndex++]),
    }));
    await expect(controller.start()).rejects.toThrow(/model load OOM/);
    expect(controller.snapshot()).toMatchObject({
      state: 'error',
      lastError: 'model load OOM',
    });
    expect(env.trackStop).toHaveBeenCalledTimes(1);
    expect(env.audioClose).toHaveBeenCalledTimes(1);
    expect(failingWorker.loadCount).toBe(1);

    await controller.start();
    expect(controller.snapshot().state).toBe('running');
    expect(freshWorker.loadCount).toBe(1);
  });

  it('retries start immediately after fatal error even when old lifecycle cleanup is still pending', async () => {
    const env = installFakeBrowserAudioEnvironment();
    env.audioClose.mockImplementation(() => new Promise<void>(() => {
      // Never resolves — old lifecycle AudioContext.close hangs forever
    }));
    const failingWorker = new FakeWorker();
    failingWorker.inferImpl = async () => {
      throw new Error('gpu kernel crash');
    };
    const freshWorker = new FakeWorker();
    const workers = [failingWorker, freshWorker];
    let workerIndex = 0;
    const controller = new BrowserMicrophoneCaptureController(pipelineOptions({
      workerClientFactory: () => workerCast(workers[workerIndex++]),
    }));
    await controller.start();

    env.worklet?.port.onmessage?.({
      data: {
        type: 'pcm-chunk',
        sourceSampleRateHz: 48_000,
        sourceStartSampleIndex: 0,
        sourceEndSampleIndex: 10_560,
        samples: fill(10_560),
      },
    });
    await settleAsyncWork();
    expect(controller.snapshot().state).toBe('error');

    // New start proceeds immediately because it creates its own lifecycle
    // Old lifecycle's AudioContext.close can hang without blocking retry
    await controller.start();
    expect(controller.snapshot().state).toBe('running');
    expect(freshWorker.loadCount).toBe(1);
  });

  it('explicit stop racing fatal cleanup always results in idle', async () => {
    const env = installFakeBrowserAudioEnvironment();
    const worker = new FakeWorker();
    worker.inferImpl = async () => {
      throw new Error('inference kaboom');
    };
    const controller = new BrowserMicrophoneCaptureController(pipelineOptions({
      workerClient: workerCast(worker),
    }));
    await controller.start();

    env.worklet?.port.onmessage?.({
      data: {
        type: 'pcm-chunk',
        sourceSampleRateHz: 48_000,
        sourceStartSampleIndex: 0,
        sourceEndSampleIndex: 10_560,
        samples: fill(10_560),
      },
    });

    await controller.stop();
    await settleAsyncWork();

    expect(controller.snapshot().state).toBe('idle');
    expect(env.trackStop).toHaveBeenCalledTimes(1);
    expect(env.audioClose).toHaveBeenCalledTimes(1);
    expect(env.portClose).toHaveBeenCalledTimes(1);
  });

  it('old Worklet onmessage from previous lifecycle cannot affect new lifecycle', async () => {
    const env = installFakeBrowserAudioEnvironment();
    const workers = [new FakeWorker(), new FakeWorker()];
    let workerIndex = 0;
    const controller = new BrowserMicrophoneCaptureController(pipelineOptions({
      workerClientFactory: () => workerCast(workers[workerIndex++]),
    }));

    await controller.start();
    const oldOnmessage = env.worklet?.port.onmessage;
    expect(oldOnmessage).toBeDefined();

    await controller.stop();
    await controller.start();
    expect(controller.snapshot().state).toBe('running');

    oldOnmessage?.({
      data: {
        type: 'pcm-chunk',
        sourceSampleRateHz: 48_000,
        sourceStartSampleIndex: 0,
        sourceEndSampleIndex: 128,
        samples: fill(128),
      },
    } as MessageEvent);
    await settleAsyncWork();

    expect(controller.snapshot().state).toBe('running');
  });

  it('preserves fixed workerClient as single-lifecycle at pipeline level and factory as restartable at controller level', async () => {
    installFakeBrowserAudioEnvironment();

    const factoryWorkers = [new FakeWorker(), new FakeWorker()];
    let fIdx = 0;
    const factoryController = new BrowserMicrophoneCaptureController(pipelineOptions({
      workerClientFactory: () => workerCast(factoryWorkers[fIdx++]),
    }));
    await factoryController.start();
    await factoryController.stop();
    await factoryController.start();
    expect(factoryController.snapshot().state).toBe('running');
    expect(factoryWorkers[0].loadCount).toBe(1);
    expect(factoryWorkers[1].loadCount).toBe(1);
    await factoryController.stop();

    const fixedWorker = new FakeWorker();
    const fixedPipeline = new LiveByteDanceRollingPipeline(pipelineOptions({
      workerClient: workerCast(fixedWorker),
    }));
    await fixedPipeline.start();
    await fixedPipeline.stop();
    await expect(fixedPipeline.start()).rejects.toThrow(/single-lifecycle|workerClientFactory/i);
  });

  it('stop during pending getUserMedia cancels startup and results in idle', async () => {
    let resolveGetUserMedia: ((stream: unknown) => void) | undefined;
    const trackStop = vi.fn();
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockImplementation(() => new Promise((resolve) => {
          resolveGetUserMedia = resolve;
        })),
      },
    });
    vi.stubGlobal('AudioContext', class { sampleRate = 48_000; });
    vi.stubGlobal('AudioWorkletNode', class { port = { close: vi.fn() }; connect = vi.fn(); disconnect = vi.fn(); addEventListener = vi.fn(); });

    const worker = new FakeWorker();
    const controller = new BrowserMicrophoneCaptureController(pipelineOptions({
      workerClient: workerCast(worker),
    }));

    const startPromise = controller.start();
    await tick();
    expect(controller.snapshot().state).toBe('requesting-permission');

    const stopPromise = controller.stop();
    await tick();

    resolveGetUserMedia?.({ getTracks: () => [{ stop: trackStop }] });
    await startPromise;
    await stopPromise;

    expect(controller.snapshot().state).toBe('idle');
    expect(trackStop).toHaveBeenCalledTimes(1);
    expect(worker.loadCount).toBe(0);
  });

  it('stop during pending audioWorklet.addModule cancels startup and results in idle', async () => {
    let resolveAddModule: (() => void) | undefined;
    const env = installFakeBrowserAudioEnvironment();
    env.workletModuleLoad.mockImplementation(() => new Promise<void>((resolve) => {
      resolveAddModule = resolve;
    }));

    const worker = new FakeWorker();
    const controller = new BrowserMicrophoneCaptureController(pipelineOptions({
      workerClient: workerCast(worker),
    }));

    const startPromise = controller.start();
    await tick();
    expect(controller.snapshot().state).toBe('initializing-audio');

    const stopPromise = controller.stop();
    await tick();

    resolveAddModule?.();
    await startPromise;
    await stopPromise;

    expect(controller.snapshot().state).toBe('idle');
    expect(env.trackStop).toHaveBeenCalledTimes(1);
    expect(env.audioClose).toHaveBeenCalledTimes(1);
    expect(worker.loadCount).toBe(0);
  });

  it('stop during pending Worker model load cancels startup and results in idle', async () => {
    let resolveLoad: (() => void) | undefined;
    const env = installFakeBrowserAudioEnvironment();
    const worker = new FakeWorker();
    worker.loadImpl = () => new Promise<undefined>((resolve) => {
      resolveLoad = () => resolve(undefined);
    });

    const controller = new BrowserMicrophoneCaptureController(pipelineOptions({
      workerClientFactory: () => workerCast(worker),
    }));

    const startPromise = controller.start();
    await tick();
    expect(controller.snapshot().state).toBe('initializing-model');

    const stopPromise = controller.stop();
    await tick();

    resolveLoad?.();
    await startPromise;
    await stopPromise;

    expect(controller.snapshot().state).toBe('idle');
    expect(env.trackStop).toHaveBeenCalledTimes(1);
    expect(env.audioClose).toHaveBeenCalledTimes(1);
    expect(worker.loadCount).toBe(1);
    expect(worker.disposeCount).toBe(1);
  });

  it('old processorerror listener from previous lifecycle cannot affect new lifecycle', async () => {
    const env = installFakeBrowserAudioEnvironment();
    const workers = [new FakeWorker(), new FakeWorker()];
    let workerIndex = 0;
    const controller = new BrowserMicrophoneCaptureController(pipelineOptions({
      workerClientFactory: () => workerCast(workers[workerIndex++]),
    }));

    await controller.start();
    const oldWorklet = env.worklet;
    const oldProcessorErrorListener = oldWorklet?.listeners?.['processorerror']?.[0];
    expect(oldProcessorErrorListener).toBeDefined();

    await controller.stop();
    await controller.start();
    expect(controller.snapshot().state).toBe('running');

    oldProcessorErrorListener?.(new Event('processorerror'));
    await settleAsyncWork();

    expect(controller.snapshot().state).toBe('running');
  });

  it('old pipeline fatal callback after restart cannot affect new lifecycle or close new resources', async () => {
    const env = installFakeBrowserAudioEnvironment();
    let rejectFirstInference: ((err: Error) => void) | undefined;
    const worker1 = new FakeWorker();
    worker1.inferImpl = () => new Promise((_, reject) => {
      rejectFirstInference = reject;
    });
    const worker2 = new FakeWorker();
    const workers = [worker1, worker2];
    let workerIndex = 0;
    const controller = new BrowserMicrophoneCaptureController(pipelineOptions({
      workerClientFactory: () => workerCast(workers[workerIndex++]),
    }));

    await controller.start();
    env.worklet?.port.onmessage?.({
      data: {
        type: 'pcm-chunk',
        sourceSampleRateHz: 48_000,
        sourceStartSampleIndex: 0,
        sourceEndSampleIndex: 10_560,
        samples: fill(10_560),
      },
    });
    await tick();

    // Now restart before first inference completes
    await controller.stop();
    await controller.start();
    expect(controller.snapshot().state).toBe('running');
    expect(worker2.loadCount).toBe(1);

    // Old lifecycle inference finally rejects with fatal error
    rejectFirstInference?.(new Error('delayed fatal error from old worker'));
    await settleAsyncWork();

    // New lifecycle must remain running and untouched
    expect(controller.snapshot().state).toBe('running');
    expect(worker2.disposeCount).toBe(0);
  });

  it('Worklet synchronous failure triggers exactly one fatal cleanup with lifecycle resources', async () => {
    const env = installFakeBrowserAudioEnvironment();
    const worker = new FakeWorker();
    const controller = new BrowserMicrophoneCaptureController(pipelineOptions({
      workerClient: workerCast(worker),
    }));
    await controller.start();

    env.worklet?.port.onmessage?.({
      data: {
        type: 'pcm-chunk',
        sourceSampleRateHz: 48_000,
        sourceStartSampleIndex: 0,
        sourceEndSampleIndex: 128,
        samples: fill(128),
      },
    });
    env.worklet?.port.onmessage?.({
      data: {
        type: 'pcm-chunk',
        sourceSampleRateHz: 48_000,
        sourceStartSampleIndex: 129,
        sourceEndSampleIndex: 257,
        samples: fill(128),
      },
    });
    await settleAsyncWork();

    expect(controller.snapshot()).toMatchObject({
      state: 'error',
      lastError: expect.stringContaining('contiguous source samples'),
    });
    expect(env.trackStop).toHaveBeenCalledTimes(1);
    expect(env.portClose).toHaveBeenCalledTimes(1);
    expect(env.audioClose).toHaveBeenCalledTimes(1);
  });

  it('fatal error without explicit stop results in error state', async () => {
    const env = installFakeBrowserAudioEnvironment();
    const worker = new FakeWorker();
    worker.inferImpl = async () => {
      throw new Error('gpu error');
    };
    const controller = new BrowserMicrophoneCaptureController(pipelineOptions({
      workerClient: workerCast(worker),
    }));
    await controller.start();

    env.worklet?.port.onmessage?.({
      data: {
        type: 'pcm-chunk',
        sourceSampleRateHz: 48_000,
        sourceStartSampleIndex: 0,
        sourceEndSampleIndex: 10_560,
        samples: fill(10_560),
      },
    });
    await settleAsyncWork();

    expect(controller.snapshot()).toMatchObject({
      state: 'error',
      lastError: 'gpu error',
    });
  });
});
