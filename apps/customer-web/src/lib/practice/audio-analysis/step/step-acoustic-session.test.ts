import { describe, expect, it } from 'vitest';

import {
  BYTEDANCE_INFERENCE_CONTRACT,
  buildByteDanceFixedAnchorWindow,
  defaultByteDanceModelManifest,
  type AcousticNoteEvent,
  type ByteDanceBrowserWorkerClient,
  type ByteDanceInferenceResult,
  type ByteDanceModelManifest,
  type ByteDancePcmInferenceRequest,
} from '../../acoustic-inference';
import { PracticeTimebase, type StepVerifierObservation, type StepVerifierTarget } from '../../local-core';
import {
  BoundedPcmSampleRing,
  buildStepFixedAnchorWindow,
  createStepCaptureTimebase,
  monoFromChannels,
  StepByteDanceAnalysisPipeline,
  STEP_BYTEDANCE_ANCHOR_STEP_SAMPLES,
  StepInferenceScheduler,
  StreamingLinearResampler,
} from './step-acoustic-session';

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
  }

  terminate(): void {
    this.terminateCount += 1;
  }
}

function workerCast(worker: FakeWorker): ByteDanceBrowserWorkerClient {
  return worker as unknown as ByteDanceBrowserWorkerClient;
}

function deterministicPcm(length: number): Float32Array {
  return Float32Array.from({ length }, (_, index) => ((index % 997) - 498) / 997);
}

function pipelineOptions(overrides: Partial<ConstructorParameters<typeof StepByteDanceAnalysisPipeline>[0]> = {}) {
  return {
    manifest: manifest(),
    sessionTimebase: new PracticeTimebase({ domainId: 'capture-domain', sampleRateHz: 16_000 }),
    sourceSampleRateHz: 48_000,
    captureSessionAnchor: () => ({ domainId: 'capture-domain', ms: 0, sampleIndex: 0 }),
    ...overrides,
  };
}

async function settleAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('STEP acoustic session', () => {
  it('keeps the live ring fixed-anchor tensor byte-equivalent to the canonical offline helper', () => {
    const source = deterministicPcm(64_000);
    const anchorSampleIndex = 32_000;
    const ring = new BoundedPcmSampleRing(64_000);
    ring.append(source, 0);

    const live = buildStepFixedAnchorWindow({
      ring,
      anchorSampleIndex,
      captureDomainStartSampleIndex: 0,
    });
    const offline = buildByteDanceFixedAnchorWindow({
      sourcePcm: source,
      sampleRateHz: 16_000,
      anchorSampleIndex,
    });

    expect(live.leftPaddingSamples).toBe(9_600);
    expect(live.realStartSampleIndex).toBe(16_000);
    expect(live.realEndSampleIndex).toBe(anchorSampleIndex + 3_520);
    expect(Array.from(live.pcm)).toEqual(Array.from(offline.pcm));
  });

  it('requires future context before building a STEP fixed-anchor tensor', () => {
    const ring = new BoundedPcmSampleRing(64_000);
    ring.append(deterministicPcm(32_000), 0);

    expect(() => buildStepFixedAnchorWindow({
      ring,
      anchorSampleIndex: 31_000,
      captureDomainStartSampleIndex: 0,
    })).toThrow('missing +220 ms future context');
  });

  it('coalesces STEP anchors under backpressure without exposing absence coverage', () => {
    const scheduler = new StepInferenceScheduler();
    const first = scheduler.nextReadyAnchor(3_520);
    expect(first).toBe(0);
    scheduler.markStarted(first ?? 0);

    expect(scheduler.nextReadyAnchor(3_520 + STEP_BYTEDANCE_ANCHOR_STEP_SAMPLES)).toBeNull();
    expect(scheduler.nextReadyAnchor(3_520 + STEP_BYTEDANCE_ANCHOR_STEP_SAMPLES * 3)).toBeNull();
    expect(scheduler.skippedAnchorCount).toBe(2);
    expect(scheduler.markCompleted()).toBe(STEP_BYTEDANCE_ANCHOR_STEP_SAMPLES * 3);
  });

  it('streams normalized PCM into the STEP verifier sink only', async () => {
    const worker = new FakeWorker();
    const timebase = createStepCaptureTimebase({ captureDomainId: 'capture-domain' });
    const target: StepVerifierTarget = {
      stepId: 'g1',
      activationGeneration: 1,
      activationBoundary: { domainId: 'capture-domain', ms: -1, sampleIndex: -16 },
      attackPitches: ['C4'],
      continuationPitches: [],
    };
    const stepObservations: StepVerifierObservation[] = [];
    const acousticEvents: AcousticNoteEvent[][] = [];
    worker.inferImpl = async (request) => ({
      requestId: request.requestId,
      events: [{
        pitch: 'C4',
        midiPitch: 60,
        onsetTime: timebase.sampleIndexToSessionTime(0),
        confidence: 0.95,
        onsetScore: 0.9,
        frameScore: 0.92,
        source: 'ACOUSTIC',
      }],
    });
    const pipeline = new StepByteDanceAnalysisPipeline(pipelineOptions({
      workerClient: workerCast(worker),
      evidenceSink: {
        currentStepTarget: () => target,
        onAcousticEvents: (events) => acousticEvents.push([...events]),
        onStepObservation: (observation) => stepObservations.push(observation),
      },
    }));

    await pipeline.start();
    pipeline.appendNormalizedPcm(deterministicPcm(4_000), 0);
    await settleAsyncWork();

    expect(worker.requests).toHaveLength(1);
    expect(acousticEvents).toHaveLength(1);
    expect(stepObservations).toHaveLength(1);
    expect(stepObservations[0].observedAttackPitches).toEqual(['C4']);
    expect(pipeline.snapshot().diagnostics?.inferenceCount).toBe(1);
    expect('trustedCoverageIntervalCount' in (pipeline.snapshot().diagnostics ?? {})).toBe(false);

    await pipeline.stop();
  });

  it('resamples source PCM monotonically and mixes channels deterministically', () => {
    const resampler = new StreamingLinearResampler(48_000, BYTEDANCE_INFERENCE_CONTRACT.sampleRateHz);
    const chunk = resampler.append({
      samples: deterministicPcm(480),
      sourceStartSampleIndex: 0,
    });

    expect(chunk.startSampleIndex).toBe(0);
    expect(chunk.endSampleIndex).toBeGreaterThan(150);
    expect(monoFromChannels([
      Float32Array.from([1, 0, -1]),
      Float32Array.from([0, 1, -1]),
    ])).toEqual(Float32Array.from([0.5, 0.5, -1]));
  });
});
