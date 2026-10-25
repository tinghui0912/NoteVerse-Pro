import { readFile, writeFile } from 'node:fs/promises';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { SourceAnalysisRuntime, type SourceAnalysisOptions } from '../acoustic/runtime/source-analysis-runtime';
import type { SourceAcousticPublication } from '../acoustic/runtime/source-publication';
import type { CaptureChunk, CaptureConsumer } from '../acoustic/source/capture-types';
import type { AcousticInferenceInput, AcousticInferenceResult } from '../acoustic/runtime/inference-types';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import type { StepAttemptIdentity } from '@/lib/practice/step/domain/attempt';
import { StepPracticeRuntime } from '@/lib/practice/step/domain/runtime';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import { StepMicrophoneInput } from './step-microphone-input';
import type { StepMicrophonePlatform } from './step-microphone-platform';

const createSource = SourceAnalysisRuntime.create.bind(SourceAnalysisRuntime);
const traces: (() => unknown)[] = [];
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  if (process.env.V25_INTEGRATION_EVIDENCE_PATH) await writeFile(process.env.V25_INTEGRATION_EVIDENCE_PATH,
    JSON.stringify({ testDouble: 'V25_DETERMINISTIC_INFERENCE_PORT_SYNTHETIC_PCM_NOT_ACOUSTIC_EVIDENCE',
      persistentInstances: traces.map(trace => trace()), realNeuralRuns: 0, realModelLoads: 0, realDecoderRuns: 0 }, null, 2), { flag: 'wx' });
});

/** Synthetic PCM and deterministic inference port. Never imports a model or decoder. */
async function rig(rate: 44100 | 48000, pitches = ['C4']) {
  const origin = rate * 7, context = Object.assign(new EventTarget(), { sampleRate: rate, currentTime: 7, state: 'running' });
  const rootStop = vi.fn(), cloneStop = vi.fn(), root = { getTracks: () => [{ stop: rootStop }], clone: vi.fn(() => ({ getTracks: () => [{ stop: cloneStop }] })) };
  const base = fixture as PracticeScoreArtifact;
  const artifact: PracticeScoreArtifact = { ...base,
    expectedPracticeGroups: base.expectedPracticeGroups.slice(0, 2).map(g => ({ ...g, pitches: ['C4'], strikeTargets: [{ ...g.strikeTargets[0], pitch: 'C4' }] })),
    practiceAttackSteps: base.practiceAttackSteps.slice(0, 2).map(s => ({ ...s, attackTargets: [{ ...s.attackTargets[0], pitch: 'C4' }] })) };
  const records: ReturnType<StepPracticeRuntime['completeAttempt']>[] = [], failures: Error[] = [];
  let source!: SourceAnalysisRuntime, publish!: SourceAnalysisOptions['onPublication'];
  let bridge!: CaptureConsumer, next = 0, sequence = 0, paused = false, failureListener: ((e: Error) => void) | undefined;
  let extraComplete: (() => void) | undefined;
  const releases: (() => void)[] = [];
  const publications: SourceAcousticPublication[] = [];
  vi.spyOn(SourceAnalysisRuntime, 'create').mockImplementation(async options => {
    publish = options.onPublication;
    source = await createSource({ ...options, onPublication: p => { publications.push(p); options.onPublication(p); } });
    return source;
  });
  const worker = {
    load: vi.fn(async () => ({ testDouble: 'V25_DETERMINISTIC_INFERENCE_PORT_NO_MODEL' })),
    run: vi.fn(async (input: AcousticInferenceInput): Promise<AcousticInferenceResult> => {
      if (paused) await new Promise<void>(resolve => releases.push(resolve));
      return { events: paused ? [] : pitches.map(pitch => ({ pitch, midiPitch: pitch === 'C5' ? 72 : pitch === 'D4' ? 62 : 60,
        targetSample: Math.ceil(input.window.ownedStartTarget) + 8000, confidence: .8, onsetScore: .8, frameScore: .8 })),
        inferenceMs: 0, decodeMs: 0, actualSessionRunCount: input.window.jobIndex + 1 };
    }),
    onFailure: (listener: (e: Error) => void) => { failureListener = listener; return () => { failureListener = undefined; }; },
    dispose: vi.fn(async () => { for (const release of releases.splice(0)) release(); }),
  };
  const feed = async (blocks = 1) => {
    for (let i = 0; i < blocks; i++) {
      const start = next, end = start + 2048;
      context.currentTime = (origin + end) / rate;
      bridge.receive({ type: 'pcm-chunk', sequence: sequence++, sourceSampleRateHz: rate, sourceStartSampleIndex: start,
        sourceEndSampleIndex: end, audioContextStartFrame: origin + start, captureTimeSeconds: (origin + start) / rate,
        inputChannelCount: 1, samples: new Float32Array(2048) }); next = end;
      if (!paused) await source.drain();
    }
  };
  let captureStopped = false;
  const stop = vi.fn(() => { if (captureStopped) return; captureStopped = true; detach(); cloneStop(); });
  let detach = () => {};
  const platform: StepMicrophonePlatform = {
    modelUrl: vi.fn(async () => 'fake://v25-not-onnx'), createWorker: vi.fn(() => worker), workletUrl: 'fake://shared-worklet',
    coefficients: async r => readFile(`public/model-assets/practice-acoustic/${r === 44100 ? 'fir-160-441' : 'fir-1-3'}.f32`),
    connectCapture: vi.fn(async options => {
      expect(options.ownership).toBe('BORROWED_SESSION_STREAM'); options.stream.clone(); bridge = options.bridge;
      detach = bridge.attachCaptureCleanup(stop);
      await feed(Math.ceil(rate * 2 / 2048));
      return { stop };
    }),
  };
  const input: StepMicrophoneInput<StepAttemptIdentity> = new StepMicrophoneInput<StepAttemptIdentity>(platform, {
    open: time => runtime.openAttempt(time), complete: (id, evidence) => {
      expect(evidence.kind).toBe('EVIDENCE'); expect(runtime.analyzeAttempt(id)).toBe(true);
      records.push(runtime.completeAttempt(id, evidence)); extraComplete?.();
    }, failure: error => failures.push(error),
  });
  const signal = new AbortController();
  const starting = input.start({ context: context as unknown as AudioContext, stream: root as unknown as MediaStream,
    localSessionId: 'v25', sourceDomainId: 'v25:capture' }, signal.signal);
  const runtime: StepPracticeRuntime = new StepPracticeRuntime({ artifact, scope: { kind: 'FULL' }, inputSource: 'MICROPHONE', clock: input.clock,
    localSessionId: 'v25', metadataClock: { nowEpochMs: () => 0 } });
  runtime.setInputUnavailable();
  const initial = await starting;
  traces.push(() => ({ rate, initialBoundary: initial, finalInput: input.snapshot(), finalDomain: runtime.snapshot(), records,
    failureMessages: failures.map(e => e.message), fakeWorkerConstructions: vi.mocked(platform.createWorker).mock.calls.length,
    fakeModelLoads: worker.load.mock.calls.length, fakeInferenceRuns: worker.run.mock.calls.length,
    fakeWorkerDisposals: worker.dispose.mock.calls.length, captureConnections: vi.mocked(platform.connectCapture).mock.calls.length,
    borrowedRootStops: rootStop.mock.calls.length, analysisCloneStops: cloneStop.mock.calls.length,
    publications: publications.map(p => ({ window: p.window, ownedThroughSourceSample: p.ownedThroughSourceSample, observations: p.observations })) }));
  const activate = () => { runtime.acceptInputAfter(initial.sessionTime); input.arm(initial); };
  const untilPublications = async (count: number) => {
    for (let i = 0; i < 100 && input.snapshot().publications < count; i++) await feed();
    expect(input.snapshot().publications).toBe(count);
  };
  return { input, runtime, initial, origin, context, worker, platform, root, rootStop, cloneStop, records, failures, activate,
    feed, untilPublications, publications, signal, source, bridge, publish: (p: SourceAcousticPublication) => publish(p),
    pause: () => { paused = true; }, workerFailure: () => failureListener?.(new Error('FAKE_WORKER_FAILURE')),
    onComplete: (fn: () => void) => { extraComplete = fn; },
    chunk: (overrides: Partial<CaptureChunk> = {}): CaptureChunk => ({ type: 'pcm-chunk', sequence, sourceSampleRateHz: rate,
      sourceStartSampleIndex: next, sourceEndSampleIndex: next + 2048, audioContextStartFrame: origin + next,
      captureTimeSeconds: (origin + next) / rate, inputChannelCount: 1, samples: new Float32Array(2048), ...overrides }),
  };
}

describe.each([44100, 48000] as const)('%i persistent microphone resource owner / TEST DOUBLES ONLY', rate => {
  it('establishes capture-origin mapping, real-capture boundary, preroll and exactly one long-lived owner graph', async () => {
    const r = await rig(rate);
    try {
      const s = r.input.snapshot();
      expect(s.resourceState).toBe('AVAILABLE'); expect(s.capture?.audioContextOriginFrame).toBe(r.origin);
      expect(s.analysis?.counts.regionsStarted).toBe(1); expect(s.analysis?.state).toBe('RUNNING');
      expect(s.analysis?.activeRegion?.sourceStart).toBeGreaterThan(rate * 1.65);
      expect(s.assembler?.phase).toBe('BLOCKED'); expect(s.assembler?.processedThroughSourceSample).toBeNull();
      expect(r.initial.capturedThroughSourceSample).toBe(s.capture?.capturedThroughSourceSample);
      expect(r.initial.sessionTime).toEqual({ domainId: 'v25', sampleIndex: r.initial.capturedThroughSourceSample,
        ms: r.origin / rate * 1000 + r.initial.capturedThroughSourceSample / rate * 1000 });
      expect(r.input.clock.nowMs()).toBe(r.context.currentTime * 1000); expect(Object.isFrozen(r.initial)).toBe(true);
      expect(r.worker.load).toHaveBeenCalledTimes(1); expect(r.platform.createWorker).toHaveBeenCalledTimes(1);
      expect(SourceAnalysisRuntime.create).toHaveBeenCalledTimes(1); expect(r.platform.connectCapture).toHaveBeenCalledTimes(1);
      r.activate(); await r.untilPublications(1);
      expect(r.records).toHaveLength(1);
      const b = r.input.retirementBoundary();
      expect(b.capturedThroughSourceSample).toBeGreaterThan(r.input.snapshot().assembler!.processedThroughSourceSample!);
      expect(b.capturedThroughSourceSample).toBe(r.input.snapshot().capture!.capturedThroughSourceSample);
      r.runtime.rearm(b.sessionTime); r.input.arm(b); await r.untilPublications(2);
      expect(r.records).toHaveLength(2); expect(r.input.snapshot().analysis?.counts.regionsStarted).toBe(1);
      expect(r.input.snapshot().assembler?.retainedObservationIdentityCount).toBe(2);
    } finally { await r.input.dispose(); }
    expect(r.worker.dispose).toHaveBeenCalledTimes(1); expect(r.cloneStop).toHaveBeenCalledTimes(1); expect(r.rootStop).not.toHaveBeenCalled();
    await r.input.dispose(); expect(r.worker.dispose).toHaveBeenCalledTimes(1);
  });

  it.each([{ pitches: ['C4'] }, { pitches: ['C4', 'C5'] }, { pitches: ['D4'] }])('runtime v6 alone interprets ordinary acoustic evidence $pitches', async ({ pitches }) => {
    const r = await rig(rate, pitches);
    try {
      r.activate(); await r.untilPublications(1);
      const record = r.runtime.snapshot().step.attempts[0];
      expect(record.verdict).toBe(pitches.length > 1 ? 'RETRY' : pitches[0] === 'C4' ? 'MATCH' : 'MISMATCH');
      expect(record.observedAttackPitches).toEqual([...pitches].sort()); expect(record.confidence).toBe(.8);
      expect(record.captureEndSessionTime.sampleIndex! - record.attemptStartSessionTime.sampleIndex!).toBe(rate * .05);
      expect(r.runtime.snapshot().version).toMatchObject({ schemaVersion: 6, runtimeVersion: 'step-source-sensitive-verdict-v6' });
      expect(r.runtime.snapshot().step).toMatchObject({ currentIndex: 0, attemptState: 'POST_VERDICT' });
      const b = r.input.retirementBoundary(); r.runtime.rearm(b.sessionTime); r.input.arm(b);
      expect(r.runtime.snapshot().step.currentIndex).toBe(record.verdict === 'MATCH' ? 1 : 0);
      expect(r.input.snapshot().analysis?.counts.regionsStarted).toBe(1); expect(r.failures).toEqual([]);
    } finally { await r.input.dispose(); }
  });

  it('POST_VERDICT observations remain remembered/discarded; delayed IDs, old timestamps and equality never satisfy identical target 2', async () => {
    const r = await rig(rate);
    try {
      r.activate(); await r.untilPublications(1); await r.untilPublications(2);
      expect(r.records).toHaveLength(1); expect(r.runtime.snapshot().step.currentIndex).toBe(0);
      const boundary = r.input.retirementBoundary(); r.runtime.rearm(boundary.sessionTime); r.input.arm(boundary);
      const old = r.publications[0], blocked = r.publications[1];
      for (const p of [old, blocked, { ...old, observations: old.observations.map(o => ({ ...o, observationId: 'new-id-old-time' })) }]) r.publish(p);
      expect(r.records).toHaveLength(1); expect(r.runtime.snapshot().step.attemptState).toBe('READY');
      r.pause(); await r.feed(3);
      const end = r.input.snapshot().capture!.capturedThroughSourceSample;
      const sample = boundary.capturedThroughSourceSample;
      const observation = (s: number, id: string) => ({ ...old.observations[0], observationId: id, sourceEventSample: s, targetSample: Math.round(s * 16000 / rate) });
      r.publish({ ...blocked, ownedThroughSourceSample: end, window: { ...blocked.window, windowIndex: blocked.window.windowIndex + 1 },
        observations: [observation(sample, 'watermark-equality'), observation(sample + 1, 'one-source-unit-later')] });
      expect(r.records).toHaveLength(2);
      const second = r.runtime.snapshot().step.attempts[1];
      expect(second.attemptStartSessionTime.sampleIndex).toBe(sample + 1);
      expect(second.captureEndSessionTime.sampleIndex).toBe(sample + 1 + rate * .05);
      expect(second.verdict).toBe('MATCH'); expect(second.observedAttackPitches).toEqual(['C4']);
      expect(r.runtime.isCompleted).toBe(false); const final = r.input.retirementBoundary(); r.runtime.rearm(final.sessionTime);
      expect(r.runtime.isCompleted).toBe(true); expect(r.failures).toEqual([]);
    } finally { await r.input.dispose(); }
  });

  it.each(['gap', 'rate', 'origin', 'nonfinite'] as const)('capture %s is terminal, cleans resources and never reconnects', async kind => {
    const r = await rig(rate);
    const chunk = r.chunk(kind === 'gap' ? { sequence: 999 } : kind === 'rate' ? { sourceSampleRateHz: rate === 44100 ? 48000 : 44100 }
      : kind === 'origin' ? { audioContextStartFrame: r.chunk().audioContextStartFrame + 1 } : { samples: new Float32Array(2048).fill(NaN) });
    expect(() => r.bridge.receive(chunk)).toThrow(); await r.input.dispose();
    expect(r.input.snapshot().resourceState).toBe('FAILED'); expect(r.failures).toHaveLength(1);
    expect(r.cloneStop).toHaveBeenCalledTimes(1); expect(r.worker.dispose).toHaveBeenCalledTimes(1); expect(r.rootStop).not.toHaveBeenCalled();
    expect(() => r.input.arm(r.initial)).toThrow(); expect(r.platform.connectCapture).toHaveBeenCalledTimes(1);
  });

  it.each(['worker', 'context', 'abort', 'mutated', 'reentrant', 'forged-boundary', 'reused-boundary', 'stale-issued-boundary', 'analysis'] as const)(
    '%s failure invalidates ownership and notifies once', async kind => {
      const r = await rig(rate);
      try {
        if (kind === 'forged-boundary') expect(() => r.input.arm({ ...r.initial })).toThrow('RETIREMENT_INVALID');
        else if (kind === 'stale-issued-boundary') { await r.feed(); expect(() => r.input.arm(r.initial)).toThrow('RETIREMENT_INVALID'); }
        else {
          r.activate();
          if (kind === 'worker') r.workerFailure();
          else if (kind === 'context') { r.context.state = 'suspended'; r.context.dispatchEvent(new Event('statechange')); }
          else if (kind === 'abort') r.signal.abort();
          else if (kind === 'reused-boundary') expect(() => r.input.arm(r.initial)).toThrow();
          else if (kind === 'analysis') { r.source.failAnalysis(new Error('FAKE_ANALYSIS_FAILURE')); }
          else if (kind === 'reentrant') {
            r.onComplete(() => { try { r.publish(r.publications[0]); } catch { /* Malicious sink swallows failure. */ } });
            for (let i = 0; i < 50 && !r.failures.length; i++) { try { await r.feed(); } catch { break; } }
          } else {
            await r.untilPublications(1); const p = r.publications[0];
            expect(() => r.publish({ ...p, observations: [{ ...p.observations[0], confidence: .1 }] })).toThrow();
          }
        }
      } finally { await r.input.dispose(); }
      expect(r.failures).toHaveLength(1); expect(r.input.snapshot().resourceState).toBe('FAILED');
      expect(r.worker.dispose).toHaveBeenCalledTimes(1); expect(r.cloneStop).toHaveBeenCalledTimes(1); expect(r.rootStop).not.toHaveBeenCalled();
      r.context.dispatchEvent(new Event('statechange')); r.workerFailure(); expect(r.failures).toHaveLength(1);
    });
});

it('dispose during asynchronous preparation cleans a late worker once and cannot reconnect', async () => {
  let resolveUrl!: (url: string) => void;
  const context = Object.assign(new EventTarget(), { sampleRate: 48000, currentTime: 0, state: 'running' });
  const platform: StepMicrophonePlatform = { modelUrl: () => new Promise(resolve => { resolveUrl = resolve; }),
    createWorker: vi.fn(), coefficients: vi.fn(), connectCapture: vi.fn(), workletUrl: 'fake://never-used' };
  const failure = vi.fn(), input = new StepMicrophoneInput(platform, { open: () => null, complete: vi.fn(), failure });
  const starting = input.start({ context: context as unknown as AudioContext, stream: {} as MediaStream,
    localSessionId: 'cancel', sourceDomainId: 'cancel:capture' }, new AbortController().signal);
  const rejected = expect(starting).rejects.toThrow('DISPOSED');
  const disposal = input.dispose(); resolveUrl('fake://never-loaded'); await rejected; await disposal;
  expect(platform.createWorker).not.toHaveBeenCalled(); expect(platform.connectCapture).not.toHaveBeenCalled();
  expect(failure).not.toHaveBeenCalled(); expect(input.snapshot().resourceState).toBe('DISPOSED');
  expect(input.dispose()).toBe(disposal);
});

it('model preparation failure is terminal without capture or fallback', async () => {
  const context = Object.assign(new EventTarget(), { sampleRate: 48000, currentTime: 0, state: 'running' });
  const worker = { load: vi.fn(async () => { throw new Error('FAKE_LOAD_FAILURE'); }), run: vi.fn(), dispose: vi.fn(async () => {}) };
  const platform: StepMicrophonePlatform = { modelUrl: async () => 'fake://not-model', createWorker: vi.fn(() => worker),
    coefficients: vi.fn(), connectCapture: vi.fn(), workletUrl: 'fake://never-used' };
  const failure = vi.fn(), input = new StepMicrophoneInput(platform, { open: () => null, complete: vi.fn(), failure });
  await expect(input.start({ context: context as unknown as AudioContext, stream: {} as MediaStream,
    localSessionId: 'load-failure', sourceDomainId: 'load-failure:capture' }, new AbortController().signal)).rejects.toThrow('FAKE_LOAD_FAILURE');
  await input.dispose(); expect(worker.load).toHaveBeenCalledTimes(1); expect(worker.dispose).toHaveBeenCalledTimes(1);
  expect(failure).toHaveBeenCalledTimes(1); expect(platform.coefficients).not.toHaveBeenCalled(); expect(platform.connectCapture).not.toHaveBeenCalled();
});
