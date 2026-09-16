import { describe, expect, it } from 'vitest';

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
} from './index';

const artifact = canonicalArtifactJson as PracticeScoreArtifact;

function manifest(): ByteDanceModelManifest {
  return defaultByteDanceModelManifest({
    modelUrl: '/models/bytedance/bytedance_note_model_fixed_anchor.onnx',
    expectedByteSize: 98_691_493,
    sha256: '6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5',
  });
}

class FakeWorker implements Pick<ByteDanceBrowserWorkerClient, 'load' | 'infer' | 'dispose'> {
  loadCount = 0;
  disposeCount = 0;
  requests: ByteDancePcmInferenceRequest[] = [];
  inferImpl: (request: ByteDancePcmInferenceRequest) => Promise<ByteDanceInferenceResult>
    = async (request) => ({ requestId: request.requestId, events: [] });

  async load(): Promise<undefined> {
    this.loadCount += 1;
    return undefined;
  }

  async infer(request: ByteDancePcmInferenceRequest): Promise<ByteDanceInferenceResult> {
    this.requests.push(request);
    return this.inferImpl(request);
  }

  async dispose(): Promise<void> {
    this.disposeCount += 1;
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

async function tick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
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
      manifest: manifest(),
      sessionTimebase: timebase,
      sourceSampleRateHz: 48_000,
      workerClient: workerCast(worker),
      evidenceSink: { onAcousticEvents: (events) => received.push([...events]) },
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
      manifest: manifest(),
      sessionTimebase: timebase,
      sourceSampleRateHz: 48_000,
      workerClient: workerCast(worker),
      evidenceSink: { onAcousticEvents: (events) => emitted.push(...events) },
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
      manifest: manifest(),
      sessionTimebase: timebase,
      sourceSampleRateHz: 48_000,
      workerClient: workerCast(worker),
      evidenceSink: { onAcousticEvents: (events) => emitted.push(...events) },
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
      manifest: manifest(),
      sessionTimebase: timebase,
      sourceSampleRateHz: 48_000,
      workerClient: workerCast(worker),
      evidenceSink: {
        currentStepTarget: () => runtime.currentTarget(),
        onStepObservation: (observation) => {
          matches.push(observation);
          runtime.observe(observation);
        },
      },
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
      manifest: manifest(),
      sessionTimebase: timebase,
      sourceSampleRateHz: 48_000,
      workerClient: workerCast(worker),
      evidenceSink: {
        currentStepTarget: () => runtime.currentTarget(),
        onStepObservation: (observation) => observations.push(observation),
      },
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
      manifest: manifest(),
      sessionTimebase: timebase,
      sourceSampleRateHz: 48_000,
      workerClient: workerCast(worker),
      evidenceSink: {
        onPerformanceEvidence: (items) => {
          observations.push(...items.map((item) => performance.observeEvidence(item)));
        },
      },
    });
    await pipeline.start();
    pipeline.appendNormalizedPcm(fill(3520), 0);
    await tick();
    pipeline.appendNormalizedPcm(fill(2400), 3520);
    await tick();
    expect(observations).toHaveLength(1);
    expect(performance.snapshot().musicalBeat).toBe(before);
  });
});
