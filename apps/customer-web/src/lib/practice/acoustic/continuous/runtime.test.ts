import canonicalArtifact from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import { ContinuousAssignmentFinalizer } from '@/lib/practice/continuous/domain/evaluation/assignment-finalizer';
import type { ContinuousEvidencePublication } from '@/lib/practice/continuous/domain/evaluation/evidence-types';
import { ContinuousPracticeSession } from '@/lib/practice/continuous/domain/practice-session';
import { type PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { ManualClock } from '@/lib/practice/kernel/timebase';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { evaluatePracticeInputCapabilities } from '../../input-capability';
import { ACOUSTIC_MODEL, assertAcousticIdentity, canonicalJson, sha256, sourceIdentity } from '../model/model-contract';
import type { AcousticInferenceInput, AcousticInferencePort, AcousticInferenceResult } from '../runtime/inference-types';
import { ACOUSTIC_RESOURCES } from '../runtime/resource-policy';
import { sourcePublication } from '../runtime/source-publication';
import type { CaptureChunk } from '../source/capture-types';
import { QualifiedSourceAdapter } from '../source/source-adapter';
import { ContinuousCaptureBridge } from './capture-bridge';
import { ContinuousAcousticProjection, type AcousticRuntimeOptions } from './continuous-projection';
import { projectContinuousEvidence } from './publication';

const coefficients = (rate = 48000) => readFile(rate === 44100 ? 'public/model-assets/practice-acoustic/fir-160-441.f32' : 'public/model-assets/practice-acoustic/fir-1-3.f32');
function result(input: AcousticInferenceInput): AcousticInferenceResult {
  const w = input.window, targetSample = Math.round(w.ownedStartTarget + Math.min(1600, (w.ownedEndTarget - w.ownedStartTarget) / 2));
  return { events: [{ midiPitch: 60, pitch: 'C4', confidence: .4, onsetScore: .6, frameScore: .4,
    targetSample }], inferenceMs: 1, decodeMs: .1, actualSessionRunCount: w.jobIndex + 1 };
}
async function setup(rate = 48000, port?: AcousticInferencePort, sink?: AcousticRuntimeOptions['onPublication']) {
  const publications: ContinuousEvidencePublication[] = [], calls: AcousticInferenceInput[] = [];
  const worker = port ?? { run: async (input: AcousticInferenceInput) => { calls.push(input); return result(input); }, dispose: vi.fn(async () => {}) };
  const runtime = await ContinuousAcousticProjection.create({ sessionDomainId: 'session', sourceDomainId: 'capture', sourceSampleRateHz: rate,
    coefficientBytes: await coefficients(rate), worker, nowAvailabilityMs: () => 10000000,
    onPublication: sink ?? (p => { publications.push(p); }) });
  const bridge = new ContinuousCaptureBridge(runtime, rate);
  let next = 0, sequence = 0;
  function feedTo(end: number, blockSize = 2048) {
    while (next < end) {
      const size = Math.min(blockSize, end - next);
      bridge.receive(packet(next, size, sequence++, rate)); next += size;
    }
  }
  feedTo(rate * 2);
  return { runtime, bridge, publications, calls, worker, feedTo };
}
function packet(start: number, n: number, sequence: number, rate = 48000): CaptureChunk {
  return { type: 'pcm-chunk', sequence, sourceSampleRateHz: rate, sourceStartSampleIndex: start,
    sourceEndSampleIndex: start + n, audioContextStartFrame: start, captureTimeSeconds: start / rate,
    inputChannelCount: 1, samples: new Float32Array(n) };
}
async function receipt(name: string, value: unknown): Promise<void> {
  if (process.env.CONTINUOUS_RUNTIME_TEST_RECEIPTS) await writeFile(path.join(process.env.CONTINUOUS_RUNTIME_TEST_RECEIPTS, name + '.json'), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}

it('binds the exact acoustic core, source identities and finite resource ceilings', async () => {
  await assertAcousticIdentity();
  expect(ACOUSTIC_MODEL).toMatchObject({ modelBytes: 98689283, ortVersion: '1.20.1', automaticFallback: false,
    inputSamples: 29120, ownedMs: 600, pastMs: 1050, futureMs: 170, onsetThreshold: .30, frameThreshold: .05 });
  for (const rate of [44100, 48000] as const) {
    const identity = sourceIdentity(rate);
    expect(await sha256(new TextEncoder().encode(canonicalJson(identity.identity)))).toBe(identity.identitySha256);
  }
  expect(ACOUSTIC_RESOURCES.maxOutstandingWindows).toBe(4);
  expect(ACOUSTIC_RESOURCES.maxUnacknowledgedBlocks).toBe(32);
  expect(evaluatePracticeInputCapabilities().acousticAnalysis.continuous.status).toBe('BROWSER_UNSUPPORTED');
  expect(evaluatePracticeInputCapabilities().acousticAnalysis.step.status).toBe('BROWSER_UNSUPPORTED');
});

for (const rate of [44100, 48000]) it(`${rate}: PCM/window/source parity, half-open ownership and exact terminal coverage`, async () => {
  const { runtime, bridge, calls, publications, feedTo } = await setup(rate);
  bridge.schedule({ type: 'BEGIN', sourceSampleIndex: rate * 2, performanceTimeMs: 0 });
  bridge.schedule({ type: 'TERMINAL', sourceSampleIndex: rate * 3.2, performanceTimeMs: 1200 });
  feedTo(rate * 3.4); await runtime.seal();
  expect(calls).toHaveLength(2); expect(publications).toHaveLength(3);
  for (const [i, call] of calls.entries()) {
    expect(call.pcm.length).toBe(29120); expect(call.pcm.every(v => v === 0)).toBe(true);
    expect(call.window).toMatchObject({ jobIndex: i, regionIndex: 0, windowIndex: i,
      ownedStartTarget: 32000 + i * 9600, ownedEndTarget: 32000 + (i + 1) * 9600,
      startSample: 32000 + (i * 600 - 1050) * 16, endSample: 32000 + ((i + 1) * 600 + 170) * 16 });
    const observation = publications[i].observations[0];
    expect(observation.performanceTimeMs).toBe(i * 600 + 100);
    expect(observation.provenance?.sourceEventSample).toBe(rate * 2 + (i * 600 + 100) * rate / 1000);
    expect(observation.provenance?.sourceSampleRateHz).toBe(rate);
    expect(Object.isFrozen(observation) && Object.isFrozen(publications[i].observations)).toBe(true);
    expect(publications[i].analyzedThroughPerformanceMs).toBeLessThan((i + 1) * 600);
  }
  expect(publications.at(-1)).toMatchObject({ analyzedThroughPerformanceMs: 1200, observations: [] });
  expect(runtime.snapshot().outstanding).toBe(0); expect(runtime.snapshot().resources.retainedPublicationEvents).toBe(0);
  expect(() => feedTo(rate * 3.5)).toThrow('ACOUSTIC_RUNTIME_CLOSED');
  await runtime.dispose();
});

for (const pauseMs of [1, 100, 2000, 5000]) it(`pause ${pauseMs}ms is context-only, resume resets ownership with continuous source identity`, async () => {
  const rate = 48000, { runtime, bridge, publications, calls, feedTo } = await setup(rate);
  const start = rate * 2, pause = start + rate * .6, resume = pause + pauseMs * 48, end = resume + rate * .6;
  bridge.schedule({ type: 'BEGIN', sourceSampleIndex: start, performanceTimeMs: 0 });
  bridge.schedule({ type: 'PAUSE', sourceSampleIndex: pause, performanceTimeMs: 600 });
  bridge.schedule({ type: 'BEGIN', sourceSampleIndex: resume, performanceTimeMs: 600 });
  bridge.schedule({ type: 'TERMINAL', sourceSampleIndex: end, performanceTimeMs: 1200 });
  // Causal fake port, not a backlog stress test.
  for (let n = start; n < end + rate * .2; n += 2048) { feedTo(Math.min(n + 2048, end + rate * .2)); await runtime.drain(); }
  await runtime.seal();
  expect(calls.map(c => [c.window.regionIndex, c.window.windowIndex])).toEqual([[0, 0], [1, 0]]);
  expect(publications.flatMap(p => p.observations).map(o => o.performanceTimeMs)).toEqual([100, 700]);
  expect(publications[1].observations[0].provenance?.sourceEventSample).toBe(resume + 4800);
  expect(runtime.snapshot().counts.segmentsDrained).toBe(2); await runtime.dispose();
});

it('multiple pauses retain no closed segment history and do not create performance-time gaps', async () => {
  const { runtime, bridge, feedTo, publications } = await setup(); let source = 96000;
  for (let i = 0; i < 12; i++) {
    bridge.schedule({ type: 'BEGIN', sourceSampleIndex: source, performanceTimeMs: i * 600 });
    source += 28800;
    bridge.schedule({ type: 'PAUSE', sourceSampleIndex: source, performanceTimeMs: (i + 1) * 600 });
    feedTo(source + 9600); await runtime.drain(); source += 9600;
  }
  runtime.requestTerminal(7200); await runtime.seal();
  expect(publications.flatMap(p => p.observations).map(o => o.performanceTimeMs)).toEqual(Array.from({ length: 12 }, (_, i) => i * 600 + 100));
  expect(runtime.snapshot().pendingSegments).toBe(0); await runtime.dispose();
});

for (const duration of [50, 601, 1180]) it(`terminal partial ${duration}ms preserves real full inputs and gapless owned intervals`, async () => {
  const { runtime, bridge, calls, feedTo } = await setup();
  bridge.schedule({ type: 'BEGIN', sourceSampleIndex: 96000, performanceTimeMs: 0 });
  const end = 96000 + duration * 48;
  bridge.schedule({ type: 'TERMINAL', sourceSampleIndex: end, performanceTimeMs: duration });
  feedTo(end + 9600); await runtime.seal();
  expect(calls.at(-1)?.window.ownedEndTarget).toBe(32000 + duration * 16);
  calls.forEach((call, i) => {
    expect(call.pcm.length).toBe(29120); expect(call.window.ownedStartTarget).toBe(i === 0 ? 32000 : calls[i - 1].window.ownedEndTarget);
    expect(call.window.endSample).toBeCloseTo(call.window.ownedEndTarget + 2720, 10);
  }); await runtime.dispose();
});

it('pre-roll is real; early begin and padded/insufficient terminal context fail closed', async () => {
  const runtime = await ContinuousAcousticProjection.create({ sessionDomainId: 's', sourceDomainId: 'd', sourceSampleRateHz: 48000,
    coefficientBytes: await coefficients(), worker: { run: async i => result(i), dispose: async () => {} },
    nowAvailabilityMs: () => 10000, onPublication: () => {} });
  runtime.append({ sourceSampleRateHz: 48000, sourceStartSampleIndex: 0, sourceEndSampleIndex: 128, samples: new Float32Array(128) });
  expect(() => runtime.beginSegment(0)).toThrow('ACOUSTIC_PREROLL_NOT_READY');
  const b = await setup(); b.bridge.schedule({ type: 'BEGIN', sourceSampleIndex: 96000, performanceTimeMs: 0 });
  b.bridge.schedule({ type: 'TERMINAL', sourceSampleIndex: 124800, performanceTimeMs: 600 }); b.feedTo(124800);
  await expect(b.runtime.seal()).rejects.toThrow('REAL_ACOUSTIC_TAIL_REQUIRED');
  b.feedTo(134400); await b.runtime.seal(); await b.runtime.dispose(); await runtime.dispose();
});

it('fifth ready window fails before allocation; queued/active results cannot publish, cleanup runs once', async () => {
  let resolve!: (value: AcousticInferenceResult) => void, active!: AcousticInferenceInput;
  const port: AcousticInferencePort = { run: async input => { active = input; return new Promise(r => { resolve = r; }); }, dispose: async () => {} };
  let delivered = 0;
  const { runtime, bridge, feedTo } = await setup(48000, port, () => { delivered++; });
  const cleanup = vi.fn(); runtime.attachCaptureCleanup(cleanup);
  bridge.schedule({ type: 'BEGIN', sourceSampleIndex: 96000, performanceTimeMs: 0 });
  feedTo(96000 + 48000); await Promise.resolve();
  expect(() => feedTo(96000 + 48000 * 3.3)).toThrow('ACOUSTIC_BACKPRESSURE_LIMIT_EXCEEDED');
  expect(runtime.snapshot().counts.windowsQueued).toBe(4); expect(runtime.snapshot().outstanding).toBe(4);
  expect(runtime.snapshot().resources.outstandingInputBytes).toBe(465920); expect(cleanup).toHaveBeenCalledTimes(1);
  const atFailure = runtime.snapshot();
  resolve(result(active)); await expect(runtime.drain()).rejects.toThrow('ACOUSTIC_BACKPRESSURE_LIMIT_EXCEEDED');
  expect(delivered).toBe(0); expect(runtime.snapshot().outstanding).toBe(0);
  await receipt('backpressure', { atFailure, afterDrain: runtime.snapshot(), delivered, cleanupCalls: cleanup.mock.calls.length });
  await runtime.dispose();
});

for (const behavior of ['throw', 'promise', 'reenter'] as const) it(`publication sink ${behavior} fails analysis without silent loss`, async () => {
  const b = await setup(48000, undefined, () => {
    if (behavior === 'throw') throw new Error('sink failed');
    if (behavior === 'promise') return Promise.resolve();
    runtime.requestTerminal(600);
  }); const runtime = b.runtime;
  b.bridge.schedule({ type: 'BEGIN', sourceSampleIndex: 96000, performanceTimeMs: 0 }); b.feedTo(144000);
  await expect(runtime.drain()).rejects.toThrow(); expect(runtime.snapshot().state).toBe('FAILED');
  expect(runtime.snapshot().counts.windowsPublished).toBe(0); await runtime.dispose();
});

for (const kind of ['gap', 'overlap', 'sequence', 'rate', 'score', 'frame'] as const) it(`capture ${kind} fails closed`, async () => {
  const { runtime, bridge } = await setup(); const p = packet(96000, 128, bridge.snapshot().nextSequence);
  const changed = kind === 'gap' ? { ...p, sourceStartSampleIndex: 96128, sourceEndSampleIndex: 96256 }
    : kind === 'overlap' ? { ...p, sourceStartSampleIndex: 0, sourceEndSampleIndex: 128 }
      : kind === 'sequence' ? { ...p, sequence: 0 } : kind === 'rate' ? { ...p, sourceSampleRateHz: 44100 }
        : kind === 'frame' ? { ...p, audioContextStartFrame: 0 } : { ...p, expectedPitch: 60 };
  expect(() => bridge.receive(changed)).toThrow(); expect(runtime.snapshot().state).toBe('FAILED'); await runtime.dispose();
});

it('unsupported rates and mutated FIR fail before runtime construction', async () => {
  await expect(QualifiedSourceAdapter.create(32000, await coefficients())).rejects.toThrow('SOURCE_SAMPLE_RATE_NOT_QUALIFIED');
  const bytes = new Uint8Array(await coefficients()); bytes[0] ^= 1;
  await expect(QualifiedSourceAdapter.create(48000, bytes)).rejects.toThrow('FIR_IDENTITY_MISMATCH');
});

it('30-minute fake-fast chronology has constant transient memory, 32 compact diagnostics and no retained event arrays', async () => {
  let windows = 0, terminals = 0;
  const port: AcousticInferencePort = { run: async input => result(input), dispose: async () => {} };
  const { runtime, bridge, feedTo } = await setup(48000, port, p => {
    if (p.observations.length) windows++; else terminals++;
  });
  bridge.schedule({ type: 'BEGIN', sourceSampleIndex: 96000, performanceTimeMs: 0 });
  const end = 96000 + 1800 * 48000;
  for (let n = 96000; n < end; n += 28800) { feedTo(Math.min(end, n + 28800)); await runtime.drain(); }
  runtime.requestTerminal(1800000); feedTo(end + 9600); await runtime.seal();
  const s = runtime.snapshot(); expect(windows).toBe(3000); expect(terminals).toBe(1);
  expect(s.counts.windowsPublished).toBe(3000); expect(s.diagnostics).toHaveLength(32);
  expect(s.diagnostics.every(d => !('observations' in d))).toBe(true);
  expect(s.resources.sessionPcmBytes).toBe(0); expect(s.resources.targetRingBytes).toBe(262144);
  expect(s.resources.sourceAdapterBytes).toBe(512 + 244); expect(s.resources.retainedPublicationEvents).toBe(0);
  expect(s.outstanding).toBe(0); expect(s.state).toBe('SEALED');
  await receipt('long_session', { seconds: 1800, neuralInferenceCount: 0, fakePortWindows: windows, snapshot: s });
  await runtime.dispose();
}, 120000);

for (const rate of [44100, 48000]) it(`${rate} streaming chunk boundaries exactly match the single-buffer FIR`, async () => {
  const bytes = await coefficients(rate), single = await QualifiedSourceAdapter.create(rate, bytes), stream = await QualifiedSourceAdapter.create(rate, bytes);
  const input = Float32Array.from({ length: rate * 3 }, (_, i) => Math.fround(Math.sin(i * .03) * .1));
  const expected = single.push(input), actual: number[] = [];
  for (let i = 0; i < input.length; i += 137) actual.push(...stream.push(input.subarray(i, i + 137)));
  expect(Float32Array.from(actual)).toEqual(expected);
  expect(createHash('sha256').update(new Uint8Array(expected.buffer)).digest('hex')).toHaveLength(64);
  expect(single.storageBytes()).toBe((rate === 44100 ? 35284 : 244) + 512);
});

it('real assignment finalizer retains source-blind ownership from the model-agnostic publication stream', async () => {
  const expected = [
    { strikeId: 'correct', groupId: 'correct', pitch: 'C4', expectedPerformanceTimeMs: 100, renderNoteIds: [] },
    { strikeId: 'missing', groupId: 'missing', pitch: 'C4', expectedPerformanceTimeMs: 700, renderNoteIds: [] },
    { strikeId: 'wrong', groupId: 'wrong', pitch: 'C4', expectedPerformanceTimeMs: 1300, renderNoteIds: [] },
    { strikeId: 'chord-c', groupId: 'chord', pitch: 'C4', expectedPerformanceTimeMs: 1900, renderNoteIds: [] },
    { strikeId: 'chord-e', groupId: 'chord', pitch: 'E4', expectedPerformanceTimeMs: 1900, renderNoteIds: [] },
  ];
  const finalizer = new ContinuousAssignmentFinalizer('session', expected);
  const physical = [{ time: 100, midi: 60, pitch: 'C4' }, { time: 1300, midi: 62, pitch: 'D4' },
    { time: 1900, midi: 60, pitch: 'C4' }, { time: 3000, midi: 67, pitch: 'G4' }];
  const worker: AcousticInferencePort = { run: async input => ({ ...result(input), events: physical.map(event => ({
    midiPitch: event.midi, pitch: event.pitch, confidence: .9, onsetScore: .9, frameScore: .9,
    targetSample: 32000 + event.time * 16,
  })) }), dispose: async () => {} };
  const { runtime, bridge, feedTo } = await setup(48000, worker, p => finalizer.publish(p));
  bridge.schedule({ type: 'BEGIN', sourceSampleIndex: 96000, performanceTimeMs: 0 });
  for (let n = 96000; n < 268800; n += 28800) { feedTo(n + 28800); await runtime.drain(); }
  runtime.requestTerminal(3600); feedTo(278400); await runtime.seal();
  const finished = finalizer.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 3600, availabilityTimeMs: 10000000 });
  expect(finished.groups.map(g => g.strikes.map(s => s.state))).toEqual([['MATCHED'], ['UNMATCHED'], ['UNMATCHED'], ['MATCHED', 'UNMATCHED']]);
  expect(finished.unattributedObservations).toHaveLength(1); expect(finished.observationAssignments).toHaveLength(4);
  await runtime.dispose();
});

it('sink calls ContinuousPracticeSession.publishAnalysis; analysis delay/failure never changes playhead or pause ownership', async () => {
  const clock = new ManualClock(0), session = new ContinuousPracticeSession({ artifact: canonicalArtifact as PracticeScoreArtifact,
      scope: { kind: 'FULL' },
      clock,
      countInBeats: 0,
      inputSource: 'MICROPHONE' });
  session.start(); clock.advance(1200);
  const before = session.clock.snapshot();
  const port: AcousticInferencePort = { run: async input => result(input), dispose: async () => {} };
  const runtime = await ContinuousAcousticProjection.create({ sessionDomainId: session.timebase.domainId, sourceDomainId: 'clock-independent',
    sourceSampleRateHz: 48000, coefficientBytes: await coefficients(), worker: port, nowAvailabilityMs: () => 2000, onPublication: p => session.publishAnalysis(p) });
  let next = 0;
  function feed(end: number) { while (next < end) { const n = Math.min(2048, end - next); runtime.append({ sourceSampleRateHz: 48000,
    sourceStartSampleIndex: next, sourceEndSampleIndex: next + n, samples: new Float32Array(n) }); next += n; } }
  feed(96000); runtime.beginSegment(0); feed(153600); runtime.requestTerminal(1200); feed(163200); await runtime.seal();
  expect(session.clock.snapshot()).toEqual(before);
  expect(session.evaluationSnapshot.interpretation.groups[0].verdict).toBe('SUPPORTED');
  await runtime.dispose();
  session.pause(); const paused = session.clock.snapshot(); clock.advance(5000);
  expect(session.clock.snapshot().performanceTimeMs).toBe(paused.performanceTimeMs);
  session.resume(); clock.advance(100); expect(session.clock.snapshot().performanceTimeMs).toBe(1300);
});

it('exact pause boundary belongs only to resumed segment, with immutable IDs independent of availability', () => {
  const segment = { index: 1, sourceStart: 144000, performanceStartMs: 600, originTarget: 48000, nextWindow: 0, queuedEndMs: 600 };
  const window = { jobIndex: 1, regionIndex: 1, windowIndex: 0, ownedStartTarget: 48000, ownedEndTarget: 57600,
    startSample: 31200, endSample: 60320 };
  const events = [599.9375, 600, 1199.9375, 1200].map(ms => ({ midiPitch: 60, pitch: 'C4', confidence: .9,
    onsetScore: .9, frameScore: .9, targetSample: 48000 + (ms - 600) * 16 }));
  const project = (availabilityTimeMs: number) => projectContinuousEvidence(sourcePublication('source', 48000, 0,
    window, { events, inferenceMs: 1, decodeMs: .1, actualSessionRunCount: 2 }, availabilityTimeMs), segment, 'session');
  expect(project(2000).observations.map(o => o.performanceTimeMs)).toEqual([600, 1199.9375]);
  expect(project(2000).observations).toEqual(project(3000).observations);
  expect(project(2000).observations[0].provenance?.sourceEventSample).toBe(144000);
});

it('manual/natural terminal waits for outstanding real work before exact-T coverage', async () => {
  for (const reason of ['STOPPED_BY_USER', 'SCOPE_COMPLETED']) {
    let finish!: (r: AcousticInferenceResult) => void, active!: AcousticInferenceInput;
    const worker: AcousticInferencePort = { run: async input => { active = input; return new Promise(resolve => { finish = resolve; }); }, dispose: async () => {} };
    const { runtime, bridge, feedTo, publications } = await setup(48000, worker);
    bridge.schedule({ type: 'BEGIN', sourceSampleIndex: 96000, performanceTimeMs: 0 });
    feedTo(124800); runtime.requestTerminal(600); feedTo(134400); await Promise.resolve();
    let sealed = false; const sealing = runtime.seal().then(() => { sealed = true; });
    await Promise.resolve(); expect(sealed, reason).toBe(false); expect(publications).toHaveLength(0);
    finish(result(active)); await sealing;
    expect(publications.at(-1)).toMatchObject({ observations: [], analyzedThroughPerformanceMs: 600 }); await runtime.dispose();
  }
});

it('worker failure while paused closes capture independently of clock', async () => {
  let failWorker!: (error: Error) => void;
  const worker: AcousticInferencePort = { run: async input => result(input), dispose: async () => {},
    onFailure: listener => { failWorker = listener; return () => {}; } };
  const { runtime, bridge, feedTo, publications } = await setup(48000, worker);
  const stopCapture = vi.fn(); runtime.attachCaptureCleanup(stopCapture);
  bridge.schedule({ type: 'BEGIN', sourceSampleIndex: 96000, performanceTimeMs: 0 });
  feedTo(124800); runtime.endSegment(600); feedTo(134400); await runtime.drain();
  const before = publications.length; failWorker(new Error('ACOUSTIC_WORKER_CRASH'));
  expect(stopCapture).toHaveBeenCalledTimes(1); expect(() => feedTo(140000)).toThrow('ACOUSTIC_WORKER_CRASH');
  expect(publications).toHaveLength(before); await runtime.dispose();
});
