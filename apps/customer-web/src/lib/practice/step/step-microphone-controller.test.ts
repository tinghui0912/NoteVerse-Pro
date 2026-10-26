import { borrowedDevices } from '../__fixtures__/device-roots';
import type { StepAttemptRecord } from './domain/attempt';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { ManualClock } from '@/lib/practice/kernel/timebase';
import { StepPracticeRuntime } from '@/lib/practice/step/domain/runtime';
import { SourceAnalysisRuntime, type SourceAnalysisOptions } from '../acoustic/runtime/source-analysis-runtime';
import type { SourceAcousticPublication } from '../acoustic/runtime/source-publication';
import type { CaptureConsumer } from '../acoustic/source/capture-types';
import type { AcousticInferenceInput } from '../acoustic/runtime/inference-types';
import { watchMicrophoneInfrastructure } from '../acoustic/source/microphone-infrastructure';
import { StepMicrophoneInput } from './step-microphone-input';
import { StepPracticeController } from './step-practice-controller';
import { browserStepPlatform, type StepPlatform } from './step-platform';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const createSource = SourceAnalysisRuntime.create.bind(SourceAnalysisRuntime);
const base = fixture as PracticeScoreArtifact;
const artifact: PracticeScoreArtifact = { ...base,
  expectedPracticeGroups: base.expectedPracticeGroups.slice(0, 3).map(g => ({ ...g, pitches: ['C4'],
    strikeTargets: [{ ...g.strikeTargets[0], pitch: 'C4' }] })),
  practiceAttackSteps: base.practiceAttackSteps.slice(0, 3).map(s => ({ ...s,
    attackTargets: [{ ...s.attackTargets[0], pitch: 'C4' }] })) };

/** Real STEP/source/assembler/chronology, deterministic PCM/inference ports. No model or device qualification. */
function rig(rate: 44100 | 48000 = 48000) {
  const origin = rate * 7;
  const track = Object.assign(new EventTarget(), { readyState: 'live', muted: false, stop: vi.fn() });
  const cloneStop = vi.fn();
  const stream = { getTracks: () => [track], getAudioTracks: () => [track], clone: vi.fn(() => ({ stop: cloneStop })) };
  const context = Object.assign(new EventTarget(), { sampleRate: Number(rate), currentTime: 7, state: 'running',
    resume: vi.fn(async () => {}), close: vi.fn(async () => { context.state = 'closed'; context.dispatchEvent(new Event('statechange')); }) });
  const metronome = { start: vi.fn(), destroy: vi.fn(), setEnabled: vi.fn(), setStepContext: vi.fn() };
  let source!: SourceAnalysisRuntime, bridge!: CaptureConsumer, publish!: SourceAnalysisOptions['onPublication'];
  let next = 0, sequence = 0, paused = false, pitches = ['C4'];
  let workerFailure: ((e: Error) => void) | undefined;
  const releases: (() => void)[] = [], publications: SourceAcousticPublication[] = [];
  vi.spyOn(SourceAnalysisRuntime, 'create').mockImplementation(async options => {
    publish = options.onPublication;
    source = await createSource({ ...options, onPublication: p => { publications.push(p); options.onPublication(p); } });
    return source;
  });
  const worker = {
    run: vi.fn(async (input: AcousticInferenceInput) => {
      if (paused) await new Promise<void>(resolve => releases.push(resolve));
      return { events: paused ? [] : pitches.map(pitch => ({ pitch, midiPitch: pitch === 'C5' ? 72 : pitch === 'D4' ? 62 : 60,
        targetSample: Math.ceil(input.window.ownedStartTarget) + 8000, confidence: .8, onsetScore: .8, frameScore: .8 })),
        inferenceMs: 0, decodeMs: 0, actualSessionRunCount: input.window.jobIndex + 1 };
    }),
    dispose: vi.fn(async () => { for (const release of releases.splice(0)) release(); }),
    onFailure: (listener: (e: Error) => void) => { workerFailure = listener; return () => { workerFailure = undefined; }; },
  };
  const feed = async (blocks = 1) => {
    for (let i = 0; i < blocks; i++) {
      const start = next, end = start + 2048;
      context.currentTime = (origin + end) / rate;
      bridge.receive({ type: 'pcm-chunk', sequence: sequence++, sourceSampleRateHz: rate, sourceStartSampleIndex: start,
        sourceEndSampleIndex: end, audioContextStartFrame: origin + start, captureTimeSeconds: (origin + start) / rate,
        inputChannelCount: 1, samples: new Float32Array(2048) });
      next = end;
      if (!paused) await source.drain();
    }
  };
  let stopped = false, detach = () => {};
  const stopCapture = vi.fn(() => { if (stopped) return; stopped = true; detach(); cloneStop(); });
  const platform: StepPlatform = {
    clock: new ManualClock(999_000), timer: { schedule: vi.fn(), cancel: vi.fn() },
    createMidi: vi.fn(), createMetronome: vi.fn(() => metronome),
    microphone: {
      createAudioContext: vi.fn(() => context as unknown as AudioContext), watchInfrastructure: watchMicrophoneInfrastructure,
      acquireInference: vi.fn(async () => worker), workletUrl: 'fake://worklet',
      coefficients: async r => readFile(`public/model-assets/practice-acoustic/${r === 44100 ? 'fir-160-441' : 'fir-1-3'}.f32`),
      connectCapture: vi.fn(async options => {
        expect(options.stream).toBe(stream); expect(options.context).toBe(context);
        expect(options.ownership).toBe('BORROWED_SESSION_STREAM');
        stream.clone(); bridge = options.bridge; detach = bridge.attachCaptureCleanup(stopCapture);
        await feed(Math.ceil(rate * 2 / 2048)); return { stop: stopCapture };
      }),
    },
  };
  const completion = vi.fn();
  const controller = new StepPracticeController({ devices: borrowedDevices(stream as unknown as MediaStream), artifact, scope: { kind: 'FULL' }, inputSource: 'MICROPHONE', platform, onNaturalCompletion: completion });
  const finalized: StepAttemptRecord[] = [];
  controller.subscribe(() => {
    const record = controller.snapshot().pendingPostVerdict;
    if (record && finalized.at(-1)?.attemptId !== record.attemptId) finalized.push(record);
  });
  const startSpy = vi.spyOn(StepMicrophoneInput.prototype, 'start');
  const input = () => startSpy.mock.contexts[0] as StepMicrophoneInput<unknown>;
  const untilFinalized = async (count: number) => {
    for (let i = 0; i < 100 && finalized.length < count; i++) await feed();
    expect(finalized).toHaveLength(count);
  };
  return { finalized, controller, platform, worker, stream, track, cloneStop, context, metronome, completion, feed, input, publications,
    untilFinalized, publish: (p: SourceAcousticPublication) => publish(p), source: () => source,
    pause: () => { paused = true; }, pitches: (p: string[]) => { pitches = p; },
    workerFailure: () => workerFailure?.(new Error('WORKER_CRASH')), origin, rate };
}

describe.each([44100, 48000] as const)('STEP microphone controller / %i / deterministic ports', rate => {
  it('initial availability commits physical retirement then arms, with one persistent graph and shared clock/context', async () => {
    const r = rig(rate), order: string[] = [];
    const accept = StepPracticeRuntime.prototype.acceptInputAfter;
    vi.spyOn(StepPracticeRuntime.prototype, 'acceptInputAfter').mockImplementation(function (this: StepPracticeRuntime, boundary) {
      expect(this.canAcceptAttempt).toBe(false); order.push('accept'); accept.call(this, boundary);
    });
    const arm = StepMicrophoneInput.prototype.arm;
    vi.spyOn(StepMicrophoneInput.prototype, 'arm').mockImplementation(function (this: StepMicrophoneInput<unknown>, boundary) {
      order.push('arm'); expect(r.controller.snapshot().sessionSnapshot!.step.inputAvailable).toBe(true);
      arm.call(this, boundary);
    });
    await r.controller.start(); await r.controller.start();
    expect(order).toEqual(['accept', 'arm']);
    expect(r.controller.snapshot()).toMatchObject({ state: 'ACTIVE', canAcceptAttempt: true, stepInteractionPhase: 'READY' });
    const initial = r.controller.snapshot().sessionSnapshot!.step;
    expect(initial.inputEligibleAfter.sampleIndex).toBe(r.input().snapshot().capture!.capturedThroughSourceSample);
    expect(initial.inputEligibleAfter.ms).toBe(7000 + initial.inputEligibleAfter.sampleIndex! / rate * 1000);
    expect(r.controller.snapshot().sessionSnapshot?.inputSource).toBe('MICROPHONE');
    expect(r.platform.microphone!.createAudioContext).toHaveBeenCalledOnce();
    expect(r.platform.microphone!.acquireInference).toHaveBeenCalledOnce();
    expect(r.platform.createMidi).not.toHaveBeenCalled(); expect(SourceAnalysisRuntime.create).toHaveBeenCalledOnce();
    expect(r.platform.createMetronome).toHaveBeenCalledWith(expect.objectContaining({ audioContext: r.context }));
    expect(r.platform.microphone!.connectCapture).toHaveBeenCalledOnce();
    await r.controller.abandon(); await r.controller.dispose(); await r.controller.dispose();
    expect(r.worker.dispose).toHaveBeenCalledOnce(); expect(r.cloneStop).toHaveBeenCalledOnce();
    expect(r.track.stop).not.toHaveBeenCalled(); expect(r.context.close).toHaveBeenCalledOnce(); expect(r.metronome.destroy).toHaveBeenCalledOnce();
    expect(r.completion).not.toHaveBeenCalled();
  });

  it.each([['C4'], ['C4', 'C5'], ['D4']])('pitch evidence %j keeps target policy, exact H50 and synchronous physical rearm', async (...pitches) => {
    const r = rig(rate); r.pitches(pitches);
    const trace: string[] = [], rearm = StepPracticeRuntime.prototype.rearm, arm = StepMicrophoneInput.prototype.arm;
    vi.spyOn(StepPracticeRuntime.prototype, 'rearm').mockImplementation(function (this: StepPracticeRuntime, boundary) {
      trace.push('rearm');
      const s = r.input().snapshot();
      expect(boundary.sampleIndex).toBe(s.capture!.capturedThroughSourceSample);
      expect(boundary.sampleIndex).toBeGreaterThan(s.assembler!.processedThroughSourceSample!);
      expect(this.currentStepIndex).toBe(0); rearm.call(this, boundary);
    });
    vi.spyOn(StepMicrophoneInput.prototype, 'arm').mockImplementation(function (this: StepMicrophoneInput<unknown>, boundary) {
      if (r.controller.snapshot().state === 'ACTIVE') expect(trace.at(-1)).toBe('rearm');
      arm.call(this, boundary); trace.push('arm');
    });
    await r.controller.start(); trace.length = 0;
    await r.untilFinalized(1);
    const step = r.controller.snapshot().sessionSnapshot!.step, record = r.finalized[0];
    const verdict = pitches.length === 1 && pitches[0] === 'C4' ? 'MATCH' : 'MISMATCH';
    expect(record.verdict).toBe(verdict);
    expect(record.observedAttackPitches).toEqual([...pitches].sort());
    expect(record.confidence).toBe(.8);
    expect(record.captureEndSessionTime.sampleIndex).toBe(record.attemptStartSessionTime.sampleIndex! + rate * 50 / 1000);
    expect(step).toMatchObject({ currentIndex: verdict === 'MATCH' ? 1 : 0, attemptState: 'READY', inputAvailable: true });
    expect(trace).toEqual(['rearm', 'arm']);
    expect(r.input().snapshot().analysis!.counts.regionsStarted).toBe(1);
    await r.controller.dispose();
  });

  it('skip retires physical capture while READY, rejects delayed IDs/old times, and cannot skip an active gesture', async () => {
    const r = rig(rate); await r.controller.start(); await r.untilFinalized(1);
    r.pause(); await r.feed(2);
    // The context clock may lead the last delivered physical block; skip uses the block, not now().
    r.context.currentTime += 10;
    const boundary = r.input().snapshot().capture!.capturedThroughSourceSample;
    r.controller.skip();
    expect(r.controller.snapshot().sessionSnapshot!.step).toMatchObject({ currentIndex: 2, attemptState: 'READY',
      inputEligibleAfter: { sampleIndex: boundary } });
    const old = r.publications[0];
    r.publish(old);
    r.publish({ ...old, ownedThroughSourceSample: boundary,
      observations: old.observations.map(o => ({ ...o, observationId: 'delayed-pre-skip', sourceEventSample: boundary - 1 })) });
    expect(r.finalized).toHaveLength(1);
    await r.feed(3);
    const end = r.input().snapshot().capture!.capturedThroughSourceSample;
    const sample = boundary + 1;
    r.publish({ ...old, window: { ...old.window, windowIndex: old.window.windowIndex + 1 }, ownedThroughSourceSample: sample + 1,
      observations: [{ ...old.observations[0], observationId: 'new-after-skip', sourceEventSample: sample }] });
    expect(r.controller.snapshot().stepInteractionPhase).toBe('CAPTURING');
    r.controller.skip(); expect(r.controller.snapshot().sessionSnapshot!.step.currentIndex).toBe(2);
    r.publish({ ...old, window: { ...old.window, windowIndex: old.window.windowIndex + 2 }, ownedThroughSourceSample: end, observations: [] });
    expect(r.finalized.at(-1)!.attemptStartSessionTime.sampleIndex).toBe(sample);
    expect(r.finalized).toHaveLength(2);
    await r.controller.abandon(); expect(r.controller.snapshot().sessionSnapshot!.step.completed).toBe(true);
    await r.controller.dispose();
  });

  it('post-verdict retirement rejects previously captured observations, including delayed new IDs and equality', async () => {
    const r = rig(rate); await r.controller.start(); await r.untilFinalized(1);
    const retired = r.input().snapshot().retiredThroughSourceSample, old = r.publications[0];
    r.pause(); await r.feed(3);
    const captured = r.input().snapshot().capture!.capturedThroughSourceSample;
    r.publish({ ...old, window: { ...old.window, windowIndex: old.window.windowIndex + 1 }, ownedThroughSourceSample: captured,
      observations: [...old.observations, ...[retired - 1, retired].map((s, i) => ({ ...old.observations[0],
        observationId: `busy-${i}`, sourceEventSample: s }))] });
    expect(r.finalized).toHaveLength(1);
    expect(r.controller.snapshot().canAcceptAttempt).toBe(true);
    await r.feed(3);
    const through = r.input().snapshot().capture!.capturedThroughSourceSample, fresh = captured + 1;
    r.publish({ ...old, window: { ...old.window, windowIndex: old.window.windowIndex + 2 }, ownedThroughSourceSample: through,
      observations: [{ ...old.observations[0], observationId: 'fresh-target-2', sourceEventSample: fresh }] });
    const step = r.controller.snapshot().sessionSnapshot!.step;
    expect(r.finalized).toHaveLength(2); expect(step.currentIndex).toBe(2);
    expect(r.finalized[1].attemptStartSessionTime.sampleIndex).toBe(fresh);
    expect(r.finalized[1].attemptId).not.toBe(r.finalized[0].attemptId);
    await r.controller.dispose();
  });

  it('physical input captured while the previous answer is busy is retired, never queued into the next attempt', async () => {
    const r = rig(rate);
    let release!: () => void;
    r.worker.run.mockImplementationOnce(async input => {
      await new Promise<void>(resolve => { release = resolve; });
      const first = Math.ceil(input.window.ownedStartTarget) + 8000;
      return { events: [first, first + 1000].map(targetSample => ({ pitch: 'C4', midiPitch: 60,
        targetSample, confidence: .8, onsetScore: .8, frameScore: .8 })),
        inferenceMs: 0, decodeMs: 0, actualSessionRunCount: input.window.jobIndex + 1 };
    });
    await r.controller.start(); r.pause();
    for (let i = 0; i < 100 && !release; i++) await r.feed();
    expect(release).toBeTypeOf('function');
    await r.feed(3);
    // Both physical events are in captured PCM while the first inference is still outstanding.
    const captureWhileBusy = r.input().snapshot().capture!.capturedThroughSourceSample;
    expect(r.finalized).toHaveLength(0); expect(r.publications).toHaveLength(0);
    expect(r.controller.snapshot().sessionSnapshot!.step.currentIndex).toBe(0);
    release(); await vi.waitFor(() => expect(r.finalized).toHaveLength(1));
    const firstPublication = r.publications[0];
    expect(firstPublication.observations).toHaveLength(2);
    const secondPhysicalEvent = firstPublication.observations[1];
    expect(secondPhysicalEvent.sourceEventSample).toBeGreaterThan(r.finalized[0].captureEndSessionTime.sampleIndex!);
    expect(secondPhysicalEvent.sourceEventSample).toBeLessThanOrEqual(captureWhileBusy);
    const retired = r.input().snapshot().retiredThroughSourceSample;
    expect(retired).toBe(captureWhileBusy);
    expect(retired).toBeGreaterThanOrEqual(secondPhysicalEvent.sourceEventSample);
    expect(r.controller.snapshot()).toMatchObject({ canAcceptAttempt: true, pendingPostVerdict: null,
      sessionSnapshot: { step: { currentIndex: 1, targetGeneration: 2, activeAttempt: null, attemptState: 'READY' } } });
    await r.feed(3);
    const through = r.input().snapshot().capture!.capturedThroughSourceSample;
    r.publish({ ...firstPublication, window: { ...firstPublication.window, windowIndex: firstPublication.window.windowIndex + 1 },
      ownedThroughSourceSample: through, observations: [secondPhysicalEvent,
        { ...secondPhysicalEvent, observationId: 'delayed-busy-event' },
        { ...secondPhysicalEvent, observationId: 'retirement-equality', sourceEventSample: retired }] });
    expect(r.finalized).toHaveLength(1);
    expect(r.controller.snapshot().sessionSnapshot!.step).toMatchObject({ currentIndex: 1, activeAttempt: null, attemptState: 'READY' });
    await r.feed(3);
    const fresh = through + 1, end = r.input().snapshot().capture!.capturedThroughSourceSample;
    r.publish({ ...firstPublication, window: { ...firstPublication.window, windowIndex: firstPublication.window.windowIndex + 2 },
      ownedThroughSourceSample: end, observations: [{ ...secondPhysicalEvent, observationId: 'fresh-answer', sourceEventSample: fresh }] });
    expect(r.finalized).toHaveLength(2);
    expect(r.finalized[1].attemptStartSessionTime.sampleIndex).toBe(fresh);
    expect(r.controller.snapshot().sessionSnapshot!.step.currentIndex).toBe(2);
    await r.controller.dispose();
  });

  it('final MATCH completes once after explicit rearm and awaited resource cleanup', async () => {
    const r = rig(rate); await r.controller.start(); await r.untilFinalized(1); await r.untilFinalized(2);
    // This test driver must not drain an already disposed source after the terminal publication.
    await expect(r.untilFinalized(3)).rejects.toThrow('ACOUSTIC_RUNTIME_CLOSED');
    await r.controller.abandon(); await r.controller.abandon();
    expect(r.controller.snapshot().lastSnapshot).toMatchObject({ runtimeStatus: 'ENDED', completionReason: 'SCOPE_COMPLETED',
      step: { currentIndex: 3, completed: true } });
    expect(r.finalized.map(a => a.verdict)).toEqual(['MATCH', 'MATCH', 'MATCH']);
    expect(r.completion).toHaveBeenCalledOnce(); expect(r.worker.dispose).toHaveBeenCalledOnce();
    expect(r.cloneStop).toHaveBeenCalledOnce(); expect(r.track.stop).not.toHaveBeenCalled(); expect(r.context.close).toHaveBeenCalledOnce();
    await r.controller.dispose(); expect(r.completion).toHaveBeenCalledOnce();
  });

  it('arm failure after domain rearm is terminal and never rolls back or reconnects', async () => {
    const r = rig(rate); await r.controller.start();
    const arm = vi.spyOn(r.input(), 'arm').mockImplementationOnce(() => { throw new Error('ARM_FAILED'); });
    await expect(r.untilFinalized(1)).rejects.toThrow('ACOUSTIC_RUNTIME_CLOSED'); await r.controller.abandon();
    expect(r.controller.snapshot()).toMatchObject({ state: 'DISPOSED', error: 'STEP_ACOUSTIC_RUNTIME_FAILED', canAcceptAttempt: false });
    expect(r.controller.snapshot().sessionSnapshot!.step.currentIndex).toBe(1);
    expect(arm).toHaveBeenCalledOnce(); expect(r.platform.microphone!.connectCapture).toHaveBeenCalledOnce();
    await r.controller.dispose(); expect(r.worker.dispose).toHaveBeenCalledOnce();
  });

  it.each(['context', 'root', 'worker', 'analysis'] as const)('%s interruption is terminal, releases once and never reconnects', async kind => {
    const r = rig(rate); await r.controller.start();
    const finalizedBeforeFailure = [...r.finalized];
    if (kind === 'context') { r.context.state = 'suspended'; r.context.dispatchEvent(new Event('statechange')); }
    if (kind === 'root') r.track.dispatchEvent(new Event('mute'));
    if (kind === 'worker') r.workerFailure();
    if (kind === 'analysis') r.source().failAnalysis(new Error('ANALYSIS_FAILURE'));
    expect(r.controller.snapshot()).toMatchObject({ state: 'ENDED', canAcceptAttempt: false });
    expect(r.controller.snapshot().error).not.toMatch(/MIDI/);
    expect(r.finalized).toEqual(finalizedBeforeFailure);
    await r.controller.abandon(); await r.controller.start(); await r.controller.dispose();
    expect(r.worker.dispose).toHaveBeenCalledOnce(); expect(r.cloneStop).toHaveBeenCalledOnce();
    expect(r.track.stop).not.toHaveBeenCalled(); expect(r.context.close).toHaveBeenCalledOnce(); expect(r.metronome.destroy).toHaveBeenCalledOnce();
    expect(r.platform.microphone!.connectCapture).toHaveBeenCalledOnce();
    r.track.dispatchEvent(new Event('ended')); r.context.dispatchEvent(new Event('statechange'));
    expect(r.worker.dispose).toHaveBeenCalledOnce(); expect(r.completion).not.toHaveBeenCalled();
  });
});

it('failed lease acquisition opens no microphone, context or capture', async () => {
  const r = rig(); vi.mocked(r.platform.microphone!.acquireInference).mockRejectedValueOnce(new Error('ACOUSTIC_LEASE_FAILURE'));
  await r.controller.start(); await r.controller.dispose();
  expect(r.controller.snapshot().error).toBe('STEP_ACOUSTIC_PREPARATION_FAILED');
  expect(r.platform.microphone!.connectCapture).not.toHaveBeenCalled();
  expect(r.worker.dispose).not.toHaveBeenCalled(); expect(r.platform.microphone!.createAudioContext).not.toHaveBeenCalled();
  expect(r.track.stop).not.toHaveBeenCalled(); expect(r.context.close).not.toHaveBeenCalled();
});

it('a lost borrowed root releases its inference lease before constructing a context or capture', async () => {
  const r = rig(); r.track.readyState = 'ended';
  await r.controller.start(); expect(r.controller.snapshot()).toMatchObject({ state: 'IDLE', error: 'STEP_MICROPHONE_UNAVAILABLE' });
  await r.controller.dispose();
  expect(r.platform.microphone!.createAudioContext).not.toHaveBeenCalled(); expect(r.worker.dispose).toHaveBeenCalledOnce();
  expect(r.track.stop).not.toHaveBeenCalled();
});

it.each(['lease', 'context'] as const)('dispose awaits pending %s and cannot resurrect a late graph', async stage => {
  const r = rig(); let release!: () => void;
  if (stage === 'context') { r.context.state = 'suspended'; vi.mocked(r.context.resume).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; })); }
  else vi.mocked(r.platform.microphone!.acquireInference).mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(r.worker); }));
  const starting = r.controller.start();
  for (let i = 0; i < 20 && !release; i++) await Promise.resolve();
  let disposed = false; const disposal = r.controller.dispose().then(() => { disposed = true; });
  await Promise.resolve(); expect(disposed).toBe(false);
  release(); await starting; await disposal;
  expect(r.controller.snapshot().state).toBe('DISPOSED');
  expect(r.track.stop).not.toHaveBeenCalled();
  expect(r.platform.microphone!.connectCapture).not.toHaveBeenCalled(); expect(r.completion).not.toHaveBeenCalled();
  expect(r.worker.dispose).toHaveBeenCalledOnce(); expect(r.context.close).toHaveBeenCalledTimes(stage === 'context' ? 1 : 0);
});

it.each(['worker', 'context'] as const)('%s cleanup failure is surfaced while all other owners are released', async resource => {
  const r = rig(); await r.controller.start();
  if (resource === 'worker') r.worker.dispose.mockRejectedValueOnce(new Error('DISPOSAL_FAILURE'));
  else r.context.close.mockRejectedValueOnce(new Error('CLOSE_FAILURE'));
  await r.controller.abandon();
  expect(r.controller.snapshot().error).toBe('STEP_RESOURCE_CLEANUP_FAILED');
  expect(r.worker.dispose).toHaveBeenCalledOnce(); expect(r.cloneStop).toHaveBeenCalledOnce();
  expect(r.track.stop).not.toHaveBeenCalled(); expect(r.context.close).toHaveBeenCalledOnce(); expect(r.metronome.destroy).toHaveBeenCalledOnce();
  await r.controller.dispose(); expect(r.worker.dispose).toHaveBeenCalledOnce();
});

it('disposal while capture connection is pending cannot expose ACTIVE or leave a late clone alive', async () => {
  const r = rig();
  const connect = vi.mocked(r.platform.microphone!.connectCapture).getMockImplementation()!;
  let release!: () => void;
  vi.mocked(r.platform.microphone!.connectCapture).mockImplementationOnce(async options => {
    const capture = await connect(options);
    await new Promise<void>(resolve => { release = resolve; });
    return capture;
  });
  const states: string[] = []; r.controller.subscribe(() => states.push(r.controller.snapshot().state));
  const starting = r.controller.start();
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const disposal = r.controller.dispose();
  expect(r.cloneStop).toHaveBeenCalledOnce(); expect(r.track.stop).not.toHaveBeenCalled();
  release(); await starting; await disposal;
  expect(states).not.toContain('ACTIVE'); expect(r.cloneStop).toHaveBeenCalledOnce();
  expect(r.worker.dispose).toHaveBeenCalledOnce(); expect(r.track.stop).not.toHaveBeenCalled(); expect(r.context.close).toHaveBeenCalledOnce();
});

it('unsupported sample rate releases its lease and fails closed before capture', async () => {
  const r = rig(); r.context.sampleRate = 32000;
  await r.controller.start(); await r.controller.dispose();
  expect(r.controller.snapshot().error).toBe('STEP_MICROPHONE_INFRASTRUCTURE_FAILED');
  expect(r.platform.microphone!.acquireInference).toHaveBeenCalledOnce(); expect(r.worker.dispose).toHaveBeenCalledOnce();
  expect(r.platform.microphone!.connectCapture).not.toHaveBeenCalled();
  expect(r.track.stop).not.toHaveBeenCalled(); expect(r.context.close).toHaveBeenCalledOnce();
});

it('browser STEP platform creates an attempt context without acquiring browser roots', () => {
  const context = {} as AudioContext, acquire = vi.fn(), createContext = vi.fn(function () { return context; });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: acquire } }); vi.stubGlobal('AudioContext', createContext);
  expect(browserStepPlatform().microphone!.createAudioContext()).toBe(context);
  expect(createContext).toHaveBeenCalledOnce(); expect(acquire).not.toHaveBeenCalled();
});

it.each([44100, 48000] as const)('%s microphone silence stays READY without any attempt or synthetic verdict', async rate => {
  const r = rig(rate); r.pitches([]);
  await r.controller.start(); await r.feed(120);
  const snapshot = r.controller.snapshot();
  expect(snapshot).toMatchObject({ state: 'ACTIVE', error: null, canAcceptAttempt: true, stepInteractionPhase: 'READY', pendingPostVerdict: null });
  expect(snapshot.sessionSnapshot!.step).toMatchObject({ currentIndex: 0, targetGeneration: 1, activeAttempt: null, pendingPostVerdict: null });
  expect(snapshot.microphoneDiagnostics!.analysis!.counts.windowsPublished).toBeGreaterThan(0);
  await r.controller.abandon();
  expect(r.finalized).toEqual([]);
});

it('STEP abandonment cancels outstanding acoustic work and rejects late owner publications', async () => {
  const r = rig(); await r.controller.start(); await r.untilFinalized(1);
  const publication = r.publications.at(-1)!; expect(publication).toBeDefined();
  r.pause(); await r.feed(30);
  await r.controller.abandon();
  const discarded = r.controller.snapshot();
  r.publish(publication);
  expect(r.controller.snapshot()).toMatchObject({ state: 'DISPOSED', canAcceptAttempt: false,
    sessionSnapshot: { localSessionId: discarded.sessionSnapshot!.localSessionId, step: discarded.sessionSnapshot!.step } });
  expect(r.completion).not.toHaveBeenCalled(); expect(r.worker.dispose).toHaveBeenCalledOnce();
  expect(r.track.stop).not.toHaveBeenCalled(); expect(r.context.close).toHaveBeenCalledOnce();
});
