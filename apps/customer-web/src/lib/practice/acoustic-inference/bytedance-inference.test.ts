import { describe, expect, it } from 'vitest';

import canonicalArtifactJson from '../local-core/__fixtures__/canonical-practice-score-artifact.json';
import {
  ManualClock,
  PerformancePracticeRuntime,
  PracticeTimebase,
  StepPracticeRuntime,
  type PracticeScoreArtifact,
} from '../local-core';
import {
  acousticEventsToPerformanceEvidence,
  acousticEventsToStepObservation,
  BYTEDANCE_INPUT_DESCRIPTOR,
  BYTEDANCE_OUTPUT_DESCRIPTORS,
  ByteDanceWorkerProtocolRuntime,
  decodeByteDanceRawOutputs,
  defaultByteDanceModelManifest,
  loadOnnxRuntimeWeb,
  pcmS16leToFloat32,
  prepareByteDanceInput,
  validateByteDanceModelManifest,
  type ByteDanceModelManifest,
  type ByteDanceOnnxRuntime,
  type ByteDancePcmInferenceRequest,
  type ByteDanceRawOutputs,
} from './index';

const artifact = canonicalArtifactJson as PracticeScoreArtifact;

function manifest(overrides: Partial<ByteDanceModelManifest> = {}): ByteDanceModelManifest {
  return {
    ...defaultByteDanceModelManifest({
      modelUrl: '/models/bytedance/note-model.onnx',
      expectedByteSize: 101_000_000,
      sha256: 'c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141',
    }),
    ...overrides,
  };
}

function request(overrides: Partial<ByteDancePcmInferenceRequest> = {}): ByteDancePcmInferenceRequest {
  const timebase = new PracticeTimebase({
    domainId: 'audio-domain',
    sampleRateHz: 16_000,
    anchorSampleIndex: 10_000,
    anchorSessionTimeMs: 2_000,
  });
  return {
    requestId: 'infer-1',
    pcm: new Float32Array(BYTEDANCE_INPUT_DESCRIPTOR.shape[1]),
    sampleRateHz: 16_000,
    channelCount: 1,
    captureStartSampleIndex: 10_000,
    captureStartTime: timebase.sampleIndexToSessionTime(10_000),
    ...overrides,
  };
}

function rawOutput(events: Array<{ frame: number; midiPitch: number; onset: number; frameScore: number }>): ByteDanceRawOutputs {
  const frameCount = 240;
  const pitchCount = 88;
  const onset = new Float32Array(frameCount * pitchCount);
  const frame = new Float32Array(frameCount * pitchCount);
  for (const event of events) {
    const pitchIndex = event.midiPitch - 21;
    onset[event.frame * pitchCount + pitchIndex] = event.onset;
    frame[event.frame * pitchCount + pitchIndex] = event.frameScore;
  }
  return {
    reg_onset_output: onset,
    reg_onset_shape: [1, frameCount, pitchCount],
    frame_output: frame,
    frame_shape: [1, frameCount, pitchCount],
  };
}

function mockRuntime(raw: ByteDanceRawOutputs): ByteDanceOnnxRuntime & { sessionCreateCount: number; runCount: number } {
  return {
    sessionCreateCount: 0,
    runCount: 0,
    async createSession() {
      this.sessionCreateCount += 1;
      return {
        run: async (_feeds, outputNames) => {
          this.runCount += 1;
          return Object.fromEntries(outputNames.map((name) => {
            if (name === BYTEDANCE_OUTPUT_DESCRIPTORS.regOnset.name) {
              return [name, { data: raw.reg_onset_output, dims: raw.reg_onset_shape }];
            }
            return [name, { data: raw.frame_output, dims: raw.frame_shape }];
          }));
        },
      };
    },
  };
}

describe('ByteDance model manifest contract', () => {
  it('accepts the validated model identity and rejects drift', () => {
    expect(() => validateByteDanceModelManifest(manifest())).not.toThrow();
    expect(() => validateByteDanceModelManifest(manifest({ modelId: 'other' as never }))).toThrow(/identity/);
    expect(() => validateByteDanceModelManifest(manifest({
      outputs: {
        ...manifest().outputs,
        regOnset: { ...manifest().outputs.regOnset, name: 'output_0' as never },
      },
    }))).toThrow(/output tensor descriptor/);
  });
});

describe('ByteDance preprocessing and decoding', () => {
  it('preserves fixed-anchor dtype shape and PCM s16le scaling', () => {
    const prepared = prepareByteDanceInput(request());
    expect(prepared.shape).toEqual([1, 29120]);
    expect(prepared.feeds.audio).toBeInstanceOf(Float32Array);
    const bytes = new Uint8Array([0, 128, 255, 127]);
    expect(Array.from(pcmS16leToFloat32(bytes))).toEqual([-1, 32767 / 32768]);
  });

  it('decodes named onset/frame descriptors into capture-aligned acoustic events', () => {
    const result = decodeByteDanceRawOutputs(
      rawOutput([
        { frame: 10, midiPitch: 60, onset: 0.7, frameScore: 0.6 },
        { frame: 10, midiPitch: 64, onset: 0.8, frameScore: 0.7 },
      ]),
      request({ inferenceRequestedAtMs: 9_999 }),
      { inferenceCompletedAtMs: 10_123 }
    );
    expect(result.map((event) => event.pitch)).toEqual(['C4', 'E4']);
    expect(result[0]).toMatchObject({
      onsetTime: { domainId: 'audio-domain', ms: 2100, sampleIndex: 11600 },
      inferenceCompletedAtMs: 10123,
      source: 'ACOUSTIC',
    });
  });

  it('rejects descriptor shape drift', () => {
    expect(() => decodeByteDanceRawOutputs({
      ...rawOutput([]),
      reg_onset_shape: [1, 240, 87],
    }, request())).toThrow(/88 piano pitches/);
  });
});

describe('ByteDance worker protocol', () => {
  it('loads once, reuses the session, infers, and disposes', async () => {
    const runtime = mockRuntime(rawOutput([{ frame: 10, midiPitch: 60, onset: 0.9, frameScore: 0.8 }]));
    const worker = new ByteDanceWorkerProtocolRuntime(runtime);

    await expect(worker.handle({ type: 'INFER', requestId: 'before-ready', input: request() }))
      .resolves.toMatchObject({ type: 'ERROR' });
    await expect(worker.handle({ type: 'LOAD', requestId: 'load', manifest: manifest() }))
      .resolves.toMatchObject({ type: 'READY' });
    await expect(worker.handle({ type: 'INFER', requestId: 'run-1', input: request() }))
      .resolves.toMatchObject({ type: 'RESULT' });
    await expect(worker.handle({ type: 'INFER', requestId: 'run-2', input: request({ requestId: 'infer-2' }) }))
      .resolves.toMatchObject({ type: 'RESULT' });
    expect(runtime.sessionCreateCount).toBe(1);
    expect(runtime.runCount).toBe(2);
    await expect(worker.handle({ type: 'DISPOSE', requestId: 'dispose' }))
      .resolves.toMatchObject({ type: 'DISPOSED' });
  });

  it('fails WebGPU provider initialization explicitly when WebGPU is unavailable', async () => {
    await expect(loadOnnxRuntimeWeb()).rejects.toThrow(/WebGPU is unavailable/);
  });
});

describe('ByteDance local practice adapters', () => {
  it('turns generic acoustic events into fresh current-step observations only', () => {
    const clock = new ManualClock(0);
    const runtime = new StepPracticeRuntime({
      artifact,
      clock,
      localSessionId: 'audio-domain',
    });
    const target = runtime.currentTarget();
    if (!target) {
      throw new Error('missing target');
    }
    const stale = decodeByteDanceRawOutputs(
      rawOutput([{ frame: 0, midiPitch: 60, onset: 0.9, frameScore: 0.8 }]),
      request({ captureStartSampleIndex: 0, captureStartTime: target.activationBoundary })
    );
    expect(acousticEventsToStepObservation(target, stale)).toBeNull();

    const fresh = decodeByteDanceRawOutputs(
      rawOutput([{ frame: 1, midiPitch: 60, onset: 0.9, frameScore: 0.8 }]),
      request({ captureStartSampleIndex: 0, captureStartTime: target.activationBoundary })
    );
    clock.advance(20);
    expect(runtime.observe(acousticEventsToStepObservation(target, fresh))).toMatchObject({ kind: 'MATCH' });

    const second = runtime.currentTarget();
    if (!second) {
      throw new Error('missing second target');
    }
    expect(acousticEventsToStepObservation(second, fresh)).toBeNull();

    const repeatedFresh = [{
      ...fresh[0],
      onsetTime: { ...second.activationBoundary, ms: second.activationBoundary.ms + 20 },
    }];
    expect(runtime.observe(acousticEventsToStepObservation(second, repeatedFresh))).toMatchObject({ kind: 'MATCH' });
  });

  it('requires complete chord pitch evidence and waits on wrong pitches', () => {
    const runtime = new StepPracticeRuntime({
      artifact,
      clock: new ManualClock(0),
      localSessionId: 'chord-domain',
      scope: {
        startGroupId: artifact.expectedPracticeGroups[3].groupId,
        endGroupId: artifact.expectedPracticeGroups[3].groupId,
      },
    });
    const target = runtime.currentTarget();
    if (!target) {
      throw new Error('missing chord target');
    }
    const partial = [{
      pitch: 'A4',
      midiPitch: 69,
      onsetTime: { ...target.activationBoundary, ms: 10 },
      confidence: 0.9,
      onsetScore: 0.9,
      frameScore: 0.8,
      source: 'ACOUSTIC' as const,
    }];
    expect(runtime.observe(acousticEventsToStepObservation(target, partial))).toMatchObject({
      kind: 'WAIT',
      reason: 'no_observation',
    });
    const complete = [
      partial[0],
      { ...partial[0], pitch: 'C5', midiPitch: 72, onsetTime: { ...target.activationBoundary, ms: 12 } },
    ];
    expect(runtime.observe(acousticEventsToStepObservation(target, complete))).toMatchObject({ kind: 'MATCH' });
  });

  it('feeds the same generic acoustic evidence into Performance evaluation without moving the clock', () => {
    const clock = new ManualClock(0);
    const performance = new PerformancePracticeRuntime({
      artifact,
      clock,
      countInBeats: 0,
      localSessionId: 'performance-acoustic',
    });
    performance.start();
    clock.advance(500);
    const before = performance.snapshot();
    const event = decodeByteDanceRawOutputs(
      rawOutput([{ frame: 0, midiPitch: 60, onset: 0.9, frameScore: 0.8 }]),
      request({
        captureStartSampleIndex: 0,
        captureStartTime: { domainId: 'performance-acoustic', ms: 0 },
      }),
      { inferenceCompletedAtMs: 10_000 }
    );
    const [observation] = acousticEventsToPerformanceEvidence(event);
    performance.observeEvidence(observation);
    expect(performance.evaluationOutcomes[0]).toMatchObject({ result: 'MATCH', source: 'ACOUSTIC' });
    expect(performance.snapshot().performanceTimeMs).toBe(before.performanceTimeMs);
  });
});
