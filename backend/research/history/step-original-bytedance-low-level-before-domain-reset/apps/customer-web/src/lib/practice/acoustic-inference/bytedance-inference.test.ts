import type { CapturedAttack } from '@/lib/practice/local-core/evidence';
import { describe, expect, it } from 'vitest';

import referenceFixture from './__fixtures__/bytedance-python-reference-contract.json';
import goldenFixture from './__fixtures__/bytedance-golden-contract.json';
import canonicalArtifactJson from '../local-core/__fixtures__/canonical-practice-score-artifact.json';
import {
  ManualClock,
  ContinuousPracticeSession,
  observationForCurrentTarget,
  PracticeTimebase,
  StepPracticeRuntime,
  type PracticeScoreArtifact,
} from '../local-core';
import {
  acousticEventsToPerformanceEvidence,
  AcousticEventStreamNormalizer,
  BYTEDANCE_INPUT_DESCRIPTOR,
  decodeByteDanceRawOutputs,
  type ByteDancePcmInferenceRequest,
  type ByteDanceRawOutputs,
} from './index';
import { defaultByteDanceModelManifest, validateByteDanceModelManifest, type ByteDanceModelManifest } from './bytedance-contract';
import { buildByteDanceFixedAnchorWindow, pcmS16leToFloat32, prepareByteDanceInput } from './bytedance-preprocess';

const artifact = canonicalArtifactJson as PracticeScoreArtifact;
const testTargetVerificationPolicy = {
  gestureCoherenceMs: 170,
  requiredGestureLookbackMs: 170,
};

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

function rawOutputWithShape(
  frameCount: number,
  events: Array<{ frame: number; midiPitch: number; onset: number; frameScore: number }>
): ByteDanceRawOutputs {
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

function midiPitch(pitch: string): number {
  const names: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let accidental = 0;
  let octaveIndex = 1;
  if (pitch.length >= 3 && ['#', 'b'].includes(pitch[1] ?? '')) {
    accidental = pitch[1] === '#' ? 1 : -1;
    octaveIndex = 2;
  }
  return (Number(pitch.slice(octaveIndex)) + 1) * 12 + (names[pitch[0]] ?? 0) + accidental;
}

describe('ByteDance model manifest contract', () => {
  it('accepts the validated model identity and rejects drift', () => {
    expect(() => validateByteDanceModelManifest(manifest())).not.toThrow();
    expect(() => validateByteDanceModelManifest(manifest({ modelId: 'other' as never }))).toThrow(/identity/);
    expect(() => validateByteDanceModelManifest(manifest({
      input: { ...manifest().input, shape: [1, 123] as never },
    }))).toThrow(/input tensor descriptor/);
    expect(() => validateByteDanceModelManifest(manifest({
      outputs: {
        ...manifest().outputs,
        regOnset: { ...manifest().outputs.regOnset, name: 'output_0' as never },
      },
    }))).toThrow(/output tensor descriptor/);
    expect(() => validateByteDanceModelManifest(manifest({
      outputs: {
        ...manifest().outputs,
        frame: { ...manifest().outputs.frame, pitchCount: 87 as never },
      },
    }))).toThrow(/output tensor descriptor/);
  });

  it('validates manifest byte size and SHA256 format', () => {
    expect(() => validateByteDanceModelManifest(manifest({ expectedByteSize: 0 }))).toThrow(
      /ByteDance model manifest must include URL, byte size, and SHA256/
    );
    expect(() => validateByteDanceModelManifest(manifest({ sha256: 'invalid' }))).toThrow(
      /ByteDance model manifest must include URL, byte size, and SHA256/
    );
  });
});
describe('ByteDance preprocessing and decoding', () => {
  it('builds the validated fixed-anchor zero-padded input window', () => {
    const source = new Float32Array(goldenFixture.sourcePcmLength);
    for (const [index, value] of goldenFixture.sourceNonZeroSamples) {
      source[index] = value;
    }
    const fixed = buildByteDanceFixedAnchorWindow({
      sourcePcm: source,
      sampleRateHz: goldenFixture.sampleRateHz,
      anchorSampleIndex: goldenFixture.anchorSampleIndex,
    });
    expect(fixed).toMatchObject({
      clipStartSampleIndex: goldenFixture.expectedFixedAnchor.clipStartSampleIndex,
      realStartSampleIndex: goldenFixture.expectedFixedAnchor.realStartSampleIndex,
      realEndSampleIndex: goldenFixture.expectedFixedAnchor.realEndSampleIndex,
      zeroPaddingSamples: goldenFixture.expectedFixedAnchor.zeroPaddingSamples,
    });
    expect(fixed.pcm).toHaveLength(goldenFixture.expectedFixedAnchor.sampleCount);
    for (const [index, value] of goldenFixture.expectedFixedAnchor.nonZeroSamples) {
      expect(fixed.pcm[index]).toBe(value);
    }
  });

  it('allows early left zero padding but refuses missing right future context', () => {
    const early = buildByteDanceFixedAnchorWindow({
      sourcePcm: new Float32Array(4000),
      sampleRateHz: 16_000,
      anchorSampleIndex: 0,
    });
    expect(early.zeroPaddingSamples).toBe(25_600);
    expect(() => buildByteDanceFixedAnchorWindow({
      sourcePcm: new Float32Array(3519),
      sampleRateHz: 16_000,
      anchorSampleIndex: 0,
    })).toThrow(/future context/);
    expect(() => buildByteDanceFixedAnchorWindow({
      sourcePcm: new Float32Array(10_000),
      sampleRateHz: 16_000,
      anchorSampleIndex: 12_000,
    })).toThrow(/beyond captured PCM/);
  });

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
      source: 'ACOUSTIC' as const,
    });
  });

  it('matches the golden fixed-anchor descriptor and onset extraction fixture', () => {
    const timebase = new PracticeTimebase({
      domainId: 'golden-domain',
      sampleRateHz: goldenFixture.sampleRateHz,
      anchorSampleIndex: goldenFixture.expectedFixedAnchor.clipStartSampleIndex,
      anchorSessionTimeMs: goldenFixture.captureStartSessionMs,
    });
    const decoded = decodeByteDanceRawOutputs(
      rawOutput(goldenFixture.rawEvents),
      request({
        captureStartSampleIndex: goldenFixture.expectedFixedAnchor.clipStartSampleIndex,
        captureStartTime: timebase.sampleIndexToSessionTime(goldenFixture.expectedFixedAnchor.clipStartSampleIndex),
      })
    );
    expect(decoded.map((event) => ({
      pitch: event.pitch,
      midiPitch: event.midiPitch,
      sampleIndex: event.onsetTime.sampleIndex,
      sessionMs: event.onsetTime.ms,
      onsetScore: Math.round(event.onsetScore * 100) / 100,
      frameScore: Math.round(event.frameScore * 100) / 100,
    }))).toEqual(goldenFixture.expectedDecodedEvents);
  });

  it('matches the mechanically generated Python reference temporally-bound fixture', () => {
    const raw = rawOutputWithShape(
      referenceFixture.rawOutputs.regOnset.shape[0],
      referenceFixture.sparseLocalRawValues.map((value) => ({
        frame: value.frameIndex,
        midiPitch: midiPitch(value.pitch),
        onset: value.onset,
        frameScore: value.frame,
      }))
    );
    const decoded = decodeByteDanceRawOutputs(
      raw,
      request({
        captureStartSampleIndex: 0,
        captureStartTime: { domainId: 'python-reference', ms: 0, sampleIndex: 0 },
      })
    );
    expect(decoded.map((event) => ({
      pitch: event.pitch,
      midiPitch: event.midiPitch,
      sampleIndex: event.onsetTime.sampleIndex,
      sessionMsFromClipStart: event.onsetTime.ms,
      onsetScore: Math.round(event.onsetScore * 100000000) / 100000000,
      frameScoreAtOnsetPeak: Math.round(event.frameScore * 100000000) / 100000000,
    }))).toEqual(referenceFixture.referenceTemporallyBoundEvents.map((event) => ({
      pitch: event.pitch,
      midiPitch: event.midiPitch,
      sampleIndex: event.sampleIndex,
      sessionMsFromClipStart: event.sessionMsFromClipStart,
      onsetScore: event.onsetScore,
      frameScoreAtOnsetPeak: event.frameScoreAtOnsetPeak,
    })));
  });

  it('collapses adjacent thresholded onset frames into one physical attack event', () => {
    const decoded = decodeByteDanceRawOutputs(
      rawOutput([
        { frame: 10, midiPitch: 60, onset: 0.21, frameScore: 0.6 },
        { frame: 11, midiPitch: 60, onset: 0.82, frameScore: 0.7 },
        { frame: 12, midiPitch: 60, onset: 0.3, frameScore: 0.65 },
      ]),
      request()
    );
    expect(decoded).toHaveLength(1);
    expect(decoded[0]).toMatchObject({ pitch: 'C4', onsetScore: expect.closeTo(0.82, 6) });
  });

  it('rejects descriptor shape drift', () => {
    expect(() => decodeByteDanceRawOutputs({
      ...rawOutput([]),
      reg_onset_shape: [1, 240, 87],
    }, request())).toThrow(/88 piano pitches/);
  });
});

describe('ByteDance acoustic event stream normalization', () => {
  it('emits one event for one physical onset repeated by overlapping inference windows', () => {
    const normalizer = new AcousticEventStreamNormalizer({ sampleRateHz: 16_000 });
    const first = decodeByteDanceRawOutputs(
      rawOutput([{ frame: 10, midiPitch: 60, onset: 0.9, frameScore: 0.8 }]),
      request({ captureStartSampleIndex: 0, captureStartTime: { domainId: 'stream', ms: 0, sampleIndex: 0 } })
    );
    const overlap = decodeByteDanceRawOutputs(
      rawOutput([{ frame: 5, midiPitch: 60, onset: 0.85, frameScore: 0.75 }]),
      request({ captureStartSampleIndex: 800, captureStartTime: { domainId: 'stream', ms: 50, sampleIndex: 800 } })
    );
    expect(first[0].onsetTime.sampleIndex).toBe(1600);
    expect(overlap[0].onsetTime.sampleIndex).toBe(1600);
    expect(normalizer.normalizeWindow(first)).toHaveLength(1);
    expect(normalizer.normalizeWindow(overlap)).toHaveLength(0);
  });

  it('emits a true same-pitch retrigger beyond the validated dedupe boundary', () => {
    const normalizer = new AcousticEventStreamNormalizer({ sampleRateHz: 16_000 });
    const first = [{
      pitch: 'C4',
      midiPitch: 60,
      onsetTime: { domainId: 'stream', ms: 100, sampleIndex: 1600 },
      confidence: 0.9,
      onsetScore: 0.9,
      frameScore: 0.9,
      source: 'ACOUSTIC' as const,
    }];
    const retrigger = [{
      ...first[0],
      onsetTime: { domainId: 'stream', ms: 160.1, sampleIndex: 2562 },
    }];
    expect(normalizer.normalizeWindow(first)).toHaveLength(1);
    expect(normalizer.normalizeWindow(retrigger)).toHaveLength(1);
  });

  it('does not use inference completion timing for attack identity', () => {
    const normalizer = new AcousticEventStreamNormalizer({ sampleRateHz: 16_000 });
    const first = [{
      pitch: 'C4',
      midiPitch: 60,
      onsetTime: { domainId: 'stream', ms: 100, sampleIndex: 1600 },
      confidence: 0.9,
      onsetScore: 0.9,
      frameScore: 0.9,
      source: 'ACOUSTIC' as const,
      inferenceCompletedAtMs: 1000,
    }];
    const duplicate = [{ ...first[0], inferenceCompletedAtMs: 5000 }];
    expect(normalizer.normalizeWindow(first)).toHaveLength(1);
    expect(normalizer.normalizeWindow(duplicate)).toHaveLength(0);
  });
});

describe('ByteDance local practice adapters', () => {
  it('turns generic acoustic events into fresh current-step observations only', () => {
    const clock = new ManualClock(0);
    const runtime = new StepPracticeRuntime({
      artifact,
      scope: { kind: 'FULL' },
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
    expect(observationForCurrentTarget(stale, target, testTargetVerificationPolicy)).toBeNull();

    const fresh = decodeByteDanceRawOutputs(
      rawOutput([{ frame: 1, midiPitch: 60, onset: 0.9, frameScore: 0.8 }]),
      request({ captureStartSampleIndex: 0, captureStartTime: target.activationBoundary })
    );
    clock.advance(20);
    expect(runtime.observe(observationForCurrentTarget(fresh, target, testTargetVerificationPolicy))).toMatchObject({ kind: 'MATCH' });

    const second = runtime.currentTarget();
    if (!second) {
      throw new Error('missing second target');
    }
    expect(observationForCurrentTarget(fresh, second, testTargetVerificationPolicy)).toBeNull();

    const repeatedFresh = [{
      ...fresh[0],
      onsetTime: { ...second.activationBoundary, ms: second.activationBoundary.ms + 20 },
    }];
    expect(runtime.observe(observationForCurrentTarget(repeatedFresh, second, testTargetVerificationPolicy))).toMatchObject({ kind: 'MATCH' });
  });

  it('requires complete chord pitch evidence and waits on wrong pitches', () => {
    const runtime = new StepPracticeRuntime({
      artifact,
      clock: new ManualClock(0),
      localSessionId: 'chord-domain',
      scope: {
        kind: 'RANGE',
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
    expect(runtime.observe(observationForCurrentTarget(partial, target, testTargetVerificationPolicy))).toMatchObject({
      kind: 'WAIT',
      reason: 'no_observation',
    });
    const complete = [
      partial[0],
      { ...partial[0], pitch: 'C5', midiPitch: 72, onsetTime: { ...target.activationBoundary, ms: 12 } },
    ];
    expect(runtime.observe(observationForCurrentTarget(complete, target, testTargetVerificationPolicy))).toMatchObject({ kind: 'MATCH' });
  });

  it('requires expected chord pitches to belong to one coherent fresh attack gesture', () => {
    const runtime = new StepPracticeRuntime({
      artifact,
      clock: new ManualClock(0),
      localSessionId: 'coherent-chord-domain',
      scope: {
        kind: 'RANGE',
        startGroupId: artifact.expectedPracticeGroups[3].groupId,
        endGroupId: artifact.expectedPracticeGroups[3].groupId,
      },
    });
    const target = runtime.currentTarget();
    if (!target) {
      throw new Error('missing chord target');
    }
    const base = target.activationBoundary;
    const farApart = [
      {
        pitch: 'A4',
        midiPitch: 69,
        onsetTime: { ...base, ms: base.ms + 10 },
        confidence: 0.9,
        onsetScore: 0.9,
        frameScore: 0.9,
        source: 'ACOUSTIC' as const,
      },
      {
        pitch: 'C5',
        midiPitch: 72,
        onsetTime: { ...base, ms: base.ms + 250 },
        confidence: 0.9,
        onsetScore: 0.9,
        frameScore: 0.9,
        source: 'ACOUSTIC' as const,
      },
    ];
    expect(observationForCurrentTarget(farApart, target, testTargetVerificationPolicy)).toBeNull();

    const coherent = [
      farApart[0],
      { ...farApart[1], onsetTime: { ...base, ms: base.ms + 30 } },
    ];
    expect(runtime.observe(observationForCurrentTarget(coherent, target, testTargetVerificationPolicy))).toMatchObject({ kind: 'MATCH' });
  });

  it('can match a later coherent chord after an earlier unrelated same-pitch event', () => {
    const runtime = new StepPracticeRuntime({
      artifact,
      clock: new ManualClock(0),
      localSessionId: 'later-chord-domain',
      scope: {
        kind: 'RANGE',
        startGroupId: artifact.expectedPracticeGroups[3].groupId,
        endGroupId: artifact.expectedPracticeGroups[3].groupId,
      },
    });
    const target = runtime.currentTarget();
    if (!target) {
      throw new Error('missing chord target');
    }
    const base = target.activationBoundary;
    const events = [
      {
        pitch: 'A4',
        midiPitch: 69,
        onsetTime: { ...base, ms: base.ms + 10 },
        confidence: 0.9,
        onsetScore: 0.9,
        frameScore: 0.9,
        source: 'ACOUSTIC' as const,
      },
      {
        pitch: 'A4',
        midiPitch: 69,
        onsetTime: { ...base, ms: base.ms + 300 },
        confidence: 0.9,
        onsetScore: 0.9,
        frameScore: 0.9,
        source: 'ACOUSTIC' as const,
      },
      {
        pitch: 'C5',
        midiPitch: 72,
        onsetTime: { ...base, ms: base.ms + 320 },
        confidence: 0.9,
        onsetScore: 0.9,
        frameScore: 0.9,
        source: 'ACOUSTIC' as const,
      },
    ];
    expect(runtime.observe(observationForCurrentTarget(events, target, testTargetVerificationPolicy))).toMatchObject({ kind: 'MATCH' });
  });

  it('does not reuse a previous-window onset after a new STEP activation', () => {
    const normalizer = new AcousticEventStreamNormalizer({ sampleRateHz: 16_000 });
    const clock = new ManualClock(0);
    const runtime = new StepPracticeRuntime({
      artifact,
      scope: { kind: 'FULL' },
      clock,
      localSessionId: 'stale-window-domain',
    });
    const first = runtime.currentTarget();
    if (!first) {
      throw new Error('missing first target');
    }
    const firstEvent = [{
      pitch: 'C4',
      midiPitch: 60,
      onsetTime: { domainId: 'stale-window-domain', ms: 10, sampleIndex: 160 },
      confidence: 0.9,
      onsetScore: 0.9,
      frameScore: 0.9,
      source: 'ACOUSTIC' as const,
    }];
    clock.advance(20);
    expect(runtime.observe(observationForCurrentTarget(normalizer.normalizeWindow(firstEvent), first, testTargetVerificationPolicy)))
      .toMatchObject({ kind: 'MATCH' });
    const second = runtime.currentTarget();
    if (!second) {
      throw new Error('missing second target');
    }
    const repeatedPreviousWindow = [{ ...firstEvent[0], inferenceCompletedAtMs: 2000 }];
    expect(observationForCurrentTarget(normalizer.normalizeWindow(repeatedPreviousWindow), second, testTargetVerificationPolicy)).toBeNull();
  });

  it('feeds the same generic acoustic evidence into Performance evaluation without moving the clock', () => {
    const clock = new ManualClock(0);
    const performance = new ContinuousPracticeSession({
      artifact,
      scope: { kind: 'FULL' },
      clock,
      countInBeats: 0,
      localSessionId: 'performance-acoustic',
    });
    performance.start();
    clock.advance(1_500);
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
    performance.publishAnalysis({
          publicationId: 'publication-29047', sessionDomainId: performance.timebase.domainId,
          analyzedThroughPerformanceMs: 1_500, availabilityTimeMs: 1_500,
          observations: ([observation]).map((attack: CapturedAttack, index: number) => ({
            observationId: 'publication-29047:' + index, pitch: attack.pitch, confidence: attack.confidence, source: attack.source,
            performanceTimeMs: performance.clock.performanceTimeAtCapture(attack.captureTime.ms) ?? -1,
          })),
        });
    expect(performance.evaluationSnapshot.groups.flatMap(group => group.strikes)[0]).toMatchObject({ state: 'MATCHED' });
    expect(performance.snapshot().performanceTimeMs).toBe(before.performanceTimeMs);
  });

  it('does not turn adjacent model-frame activation from one attack into a CONTINUOUS duplicate', () => {
    const normalizer = new AcousticEventStreamNormalizer({ sampleRateHz: 16_000 });
    const clock = new ManualClock(0);
    const performance = new ContinuousPracticeSession({
      artifact,
      scope: { kind: 'FULL' },
      clock,
      countInBeats: 0,
      localSessionId: 'continuous-duplicate-regression',
    });
    performance.start();
    const decoded = decodeByteDanceRawOutputs(
      rawOutput([
        { frame: 0, midiPitch: 60, onset: 0.25, frameScore: 0.7 },
        { frame: 1, midiPitch: 60, onset: 0.9, frameScore: 0.8 },
        { frame: 2, midiPitch: 60, onset: 0.3, frameScore: 0.75 },
      ]),
      request({
        captureStartSampleIndex: 0,
        captureStartTime: { domainId: 'continuous-duplicate-regression', ms: 0 },
      }),
      { inferenceCompletedAtMs: 20_000 }
    );
    expect(decoded).toHaveLength(1);
    const observations = acousticEventsToPerformanceEvidence(normalizer.normalizeWindow(decoded));
    for (const observation of observations) {
      clock.advance(Math.max(0, observation.captureTime.ms - clock.nowMs()));
    }
    clock.advance(Math.max(0, 1_500 - clock.nowMs()));
    performance.publishAnalysis({
          publicationId: 'publication-30701', sessionDomainId: performance.timebase.domainId,
          analyzedThroughPerformanceMs: 1_500, availabilityTimeMs: 1_500,
          observations: (observations).map((attack: CapturedAttack, index: number) => ({
            observationId: 'publication-30701:' + index, pitch: attack.pitch, confidence: attack.confidence, source: attack.source,
            performanceTimeMs: performance.clock.performanceTimeAtCapture(attack.captureTime.ms) ?? -1,
          })),
        });
    expect(performance.evaluationSnapshot.groups.flatMap(group => group.strikes)[0]).toMatchObject({ state: 'MATCHED' });
    expect(performance.evaluationSnapshot.extras).toEqual([]);
  });

  it('preserves simultaneous chord evidence for CONTINUOUS evaluation', () => {
    const clock = new ManualClock(0);
    const performance = new ContinuousPracticeSession({
      artifact,
      clock,
      countInBeats: 0,
      localSessionId: 'continuous-chord',
      scope: {
        kind: 'RANGE',
        startGroupId: artifact.expectedPracticeGroups[3].groupId,
        endGroupId: artifact.expectedPracticeGroups[3].groupId,
      },
    });
    performance.start();
    const decoded = decodeByteDanceRawOutputs(
      rawOutput([
        { frame: 0, midiPitch: 69, onset: 0.9, frameScore: 0.8 },
        { frame: 0, midiPitch: 72, onset: 0.85, frameScore: 0.75 },
      ]),
      request({
        captureStartSampleIndex: 0,
        captureStartTime: { domainId: 'continuous-chord', ms: 0 },
      })
    );
    clock.advance(250);
    performance.publishAnalysis({
          publicationId: 'publication-31930', sessionDomainId: performance.timebase.domainId,
          analyzedThroughPerformanceMs: 250, availabilityTimeMs: 250,
          observations: (acousticEventsToPerformanceEvidence(decoded)).map((attack: CapturedAttack, index: number) => ({
            observationId: 'publication-31930:' + index, pitch: attack.pitch, confidence: attack.confidence, source: attack.source,
            performanceTimeMs: performance.clock.performanceTimeAtCapture(attack.captureTime.ms) ?? -1,
          })),
        });
    expect(performance.evaluationSnapshot.groups.flatMap(group => group.strikes).every((strike) => strike.state === 'MATCHED')).toBe(true);
    expect(performance.evaluationSnapshot.extras).toEqual([]);
  });
});

