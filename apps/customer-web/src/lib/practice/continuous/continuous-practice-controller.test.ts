import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../local-core/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '../local-core/artifact';
import { ManualClock } from '../local-core/timebase';
import { ContinuousPracticeController } from './continuous-practice-controller';
import type { ContinuousPlatform, ContinuousModelWorker } from './continuous-input';
import type { ContinuousCaptureBridge } from '../acoustic-inference/continuous/capture-bridge';
import type { BrowserMidiControllerOptions } from '../midi/browser-midi-controller';
import { PerformanceRecorder } from '../performance-recorder';
import { completedPerformanceStore } from '../completed-performance';

function track() {
  const events = new EventTarget();
  let state = 'live'; return { kind: 'audio', get readyState() { return state; },
    stop: vi.fn(() => { state = 'ended'; events.dispatchEvent(new Event('ended')); }),
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events) };
}
type TestStream = { media: MediaStream; audio: ReturnType<typeof track>; copies: TestStream[] };
function stream(): TestStream {
  const audio = track(); const copies: TestStream[] = [];
  const media = { getTracks: () => [audio], getAudioTracks: () => [audio], getVideoTracks: () => [],
    clone: () => { const copy = stream(); copies.push(copy); return copy.media; } } as unknown as MediaStream;
  return { media, audio, copies };
}
class Recorder {
  state = 'inactive'; mimeType = 'audio/webm';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null; onerror: (() => void) | null = null;
  start() { this.state = 'recording'; } pause() { this.state = 'paused'; } resume() { this.state = 'recording'; }
  requestData() { this.ondataavailable?.({ data: new Blob(['recording']) }); }
  stop() { this.state = 'inactive'; this.onstop?.(); }
}
function environment(rate = 48000) {
  const root = stream(), clock = new ManualClock(0);
  let frame = 0, sequence = 0, bridge: ContinuousCaptureBridge | undefined, captureStopped = false;
  let fail: ((error: Error) => void) | undefined;
  let runs = 0, midiOptions: BrowserMidiControllerOptions | undefined;
  const events = new EventTarget();
  const context = { currentTime: 0, sampleRate: rate, state: 'running',
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    resume: vi.fn(async () => {}), close: vi.fn(async () => { context.state = 'closed'; events.dispatchEvent(new Event('statechange')); }) };
  const worker: ContinuousModelWorker = { load: vi.fn(async () => ({})),
    run: vi.fn(async () => ({ events: [], inferenceMs: 0, decodeMs: 0, actualSessionRunCount: ++runs })),
    dispose: vi.fn(async () => {}), onFailure: listener => { fail = listener; return () => { fail = undefined; }; } };
  const meter = { start: vi.fn(), stop: vi.fn(), pause: vi.fn(), resume: vi.fn(), destroy: vi.fn(), setEnabled: vi.fn(), syncContinuous: vi.fn() };
  const platform: ContinuousPlatform = {
    midiClock: clock, modelUrl: vi.fn(async () => '/model'), createWorker: vi.fn(() => worker),
    acquireMicrophone: vi.fn(async () => root.media), createAudioContext: vi.fn(() => context as unknown as AudioContext),
    coefficients: async sourceRate => {
      if (sourceRate !== 44100 && sourceRate !== 48000) throw new Error('SOURCE_SAMPLE_RATE_NOT_QUALIFIED');
      return new Uint8Array(readFileSync(`public/model-assets/continuous/${sourceRate === 44100 ? 'fir-160-441' : 'fir-1-3'}.f32`));
    }, workletUrl: '/worklet',
    connectCapture: async options => {
      expect(options.context).toBe(context);
      bridge = options.bridge; const clone = options.stream.clone();
      const stop = vi.fn(() => { if (captureStopped) return; captureStopped = true; detach(); clone.getTracks().forEach(t => t.stop()); });
      const detach = bridge.runtime.attachCaptureCleanup(stop);
      await feed(1800); return { stop };
    },
    createMidi: vi.fn(options => { midiOptions = options; return { start: async () => {}, dispose: vi.fn(),
      getState: () => ({ connectedInputCount: 1, isRunning: true, isSupported: true, hasPermission: true }) }; }),
    createRecorder: mode => new PerformanceRecorder(mode), createMetronome: vi.fn(() => meter),
  };
  let controller: ContinuousPracticeController | undefined;
  async function feed(ms: number) {
    const end = frame + Math.ceil(ms / 1000 * rate / 128) * 128;
    while (frame < end && context.state !== 'closed') {
      const start = frame; frame += 128; context.currentTime = Math.max(context.currentTime, frame / rate);
      if (!captureStopped && bridge) bridge.receive({ type: 'pcm-chunk', sequence: sequence++, sourceSampleRateHz: rate,
        sourceStartSampleIndex: start, sourceEndSampleIndex: frame, audioContextStartFrame: start,
        captureTimeSeconds: start / rate, inputChannelCount: 1, samples: new Float32Array(128) });
      controller?.refresh(); await vi.advanceTimersByTimeAsync(1);
    }
    await vi.advanceTimersByTimeAsync(10);
  }
  function create(inputSource: 'MIDI' | 'MICROPHONE' = 'MICROPHONE', countInBeats = 0, recordingMode: 'OFF' | 'AUDIO' = 'OFF') {
    const artifact: PracticeScoreArtifact = { ...fixture as PracticeScoreArtifact, scoreEndBeat: 2.4,
      expectedPracticeGroups: fixture.expectedPracticeGroups.slice(0, 1), practiceAttackSteps: fixture.practiceAttackSteps.slice(0, 1) };
    controller = new ContinuousPracticeController({ artifact, scope: { kind: 'FULL' }, inputSource, countInBeats,
      tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm: 120 }, recordingMode }, platform);
    return controller;
  }
  return { create, platform, root, context, clock, worker, meter, feed, failure: () => fail?.(new Error('TEST_WORKER_FAILURE')),
    bridge: () => bridge!, midiOptions: () => midiOptions! };
}

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('MediaRecorder', Recorder); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('Continuous application owner', () => {
  for (const status of ['RUNNING', 'PAUSED', 'FINALIZING'] as const) for (const event of ['ended', 'mute']) {
    it(`source ${event} during ${status} fatally closes input and never stores completed truth`, async () => {
      const store = vi.spyOn(completedPerformanceStore, 'setPerformance');
      const f = environment(), controller = f.create('MICROPHONE', 0, 'AUDIO');
      await controller.start(); await f.feed(100);
      if (status === 'PAUSED') controller.pause();
      const completion = status === 'FINALIZING' ? controller.finish() : Promise.resolve();
      f.root.audio.dispatchEvent(new Event(event));
      const count = f.bridge().runtime.snapshot().counts.windowsPublished;
      await f.feed(300); await completion;
      expect(controller.snapshot().session).toBe('FAILED');
      expect(controller.snapshot().inputError).toBe('MICROPHONE_SOURCE_LOST');
      expect(controller.snapshot().completed).toBeNull(); expect(controller.snapshot().evaluation).toBeNull();
      expect(controller.snapshot().recording).toBeNull(); expect(store).not.toHaveBeenCalled();
      expect(f.bridge().runtime.snapshot().counts.windowsPublished).toBe(count);
      expect(f.worker.dispose).toHaveBeenCalledTimes(1); expect(f.context.close).toHaveBeenCalledTimes(1);
      expect(f.root.audio.stop).toHaveBeenCalledTimes(1); await controller.dispose(); store.mockRestore();
    });
  }
  for (const state of ['suspended', 'interrupted', 'closed']) for (const paused of [false, true]) {
    it(`context ${state} while ${paused ? 'PAUSED' : 'RUNNING'} is fatal, unlike Worker failure`, async () => {
      const store = vi.spyOn(completedPerformanceStore, 'setPerformance');
      const f = environment(), controller = f.create(); await controller.start(); if (paused) controller.pause();
      f.context.state = state; f.context.dispatchEvent(new Event('statechange')); await f.feed(10);
      expect(controller.snapshot().session).toBe('FAILED'); expect(controller.snapshot().inputError).toBe('AUDIO_CONTEXT_INTERRUPTED');
      expect(controller.snapshot().completed).toBeNull(); expect(store).not.toHaveBeenCalled();
      expect(f.worker.dispose).toHaveBeenCalledTimes(1); await controller.dispose(); store.mockRestore();
    });
  }
  for (const fault of ['worker-dispose', 'context-close', 'recorder-stop', 'recorder-stop-reject', 'recorder-finalize', 'recorder-cleanup']) {
    it(`settles ${fault} failure without COMPLETE, unhandled rejection or double cleanup`, async () => {
      const store = vi.spyOn(completedPerformanceStore, 'setPerformance');
      const f = environment(); const recorder = new PerformanceRecorder('AUDIO');
      f.platform.createRecorder = () => recorder;
      const controller = f.create('MICROPHONE', 0, 'AUDIO'); await controller.start(); await f.feed(100);
      if (fault === 'worker-dispose') f.worker.dispose = vi.fn(async () => { throw new Error('dispose rejected'); });
      if (fault === 'context-close') f.context.close = vi.fn(async () => { throw new Error('close rejected'); });
      if (fault === 'recorder-stop') recorder.freeze = () => { throw new Error('RECORDER_STOP_FAILED'); };
      if (fault === 'recorder-stop-reject') recorder.freeze = async () => { throw new Error('RECORDER_STOP_FAILED'); };
      if (fault === 'recorder-finalize') recorder.finalize = async () => { throw new Error('RECORDER_FINALIZE_FAILED'); };
      if (fault === 'recorder-cleanup') {
        const release = recorder.stopAndCleanup.bind(recorder);
        recorder.stopAndCleanup = () => { release(); throw new Error('RECORDER_CLEANUP_FAILED'); };
      }
      const completion = controller.finish(); await f.feed(400); await completion;
      expect(controller.snapshot().session).toBe('FAILED'); expect(controller.snapshot().completed).toBeNull();
      expect(store).not.toHaveBeenCalled(); expect(f.root.audio.stop).toHaveBeenCalledTimes(1);
      expect(f.worker.dispose).toHaveBeenCalledTimes(1); expect(f.context.close).toHaveBeenCalledTimes(1);
      await controller.dispose(); expect(f.worker.dispose).toHaveBeenCalledTimes(1); store.mockRestore();
    });
  }
  it('fresh controller after fatal source loss uses fresh owned resources', async () => {
    const first = environment(), failed = first.create(); await failed.start();
    first.root.audio.dispatchEvent(new Event('mute')); await first.feed(5); await failed.dispose();
    const next = environment(), fresh = next.create(); await fresh.start(); await next.feed(1600);
    expect(fresh.snapshot().session).toBe('COMPLETE'); expect(next.worker).not.toBe(first.worker);
    expect(next.context).not.toBe(first.context); await fresh.dispose();
  });
  it('MIDI natural completion owns one evaluation without acoustic dependencies', async () => {
    const f = environment(), controller = f.create('MIDI'); await controller.start();
    f.clock.set(1201); controller.refresh(); await controller.finish();
    expect(controller.snapshot().completed?.evaluation.status).toBe('COMPLETE');
    expect(f.platform.createWorker).not.toHaveBeenCalled(); expect(f.platform.acquireMicrophone).not.toHaveBeenCalled();
    expect(f.platform.createAudioContext).not.toHaveBeenCalled(); await controller.dispose();
  });
  it('MIDI pause/resume and manual Stop preserve identity and accumulated result', async () => {
    const f = environment(), controller = f.create('MIDI'); await controller.start();
    f.clock.set(100); controller.pause(); const T = controller.snapshot().transport!.performanceTimeMs;
    f.clock.set(600); controller.resume(); expect(controller.snapshot().transport!.performanceTimeMs).toBe(T);
    await controller.finish(); expect(controller.snapshot().completed?.evaluation.status).toBe('COMPLETE'); await controller.dispose();
  });
  it('bounds controller diagnostics across 100 transport cycles', async () => {
    const f = environment(), controller = f.create('MIDI'); await controller.start();
    for (let i = 0; i < 100; i++) { f.clock.advance(1); controller.pause(); f.clock.advance(1); controller.resume(); }
    expect(controller.engineeringSnapshot().diagnostics).toHaveLength(32);
    expect(Object.isFrozen(controller.engineeringSnapshot().diagnostics)).toBe(true);
    await controller.finish(); await controller.dispose();
  });
  for (const rate of [44100, 48000]) it(`microphone count-in and natural terminal at ${rate}`, async () => {
    const f = environment(rate), controller = f.create('MICROPHONE', 1); await controller.start();
    expect(controller.snapshot().transport?.state).toBe('COUNT_IN');
    expect(f.bridge().runtime.snapshot().counts.segmentsStarted).toBe(0);
    await f.feed(2100);
    expect(controller.snapshot().session).toBe('COMPLETE'); expect(controller.snapshot().completed?.evaluation.status).toBe('COMPLETE');
    expect(f.platform.acquireMicrophone).toHaveBeenCalledTimes(1); expect(f.platform.createAudioContext).toHaveBeenCalledTimes(1);
    expect(f.platform.createMetronome).toHaveBeenCalledWith(expect.objectContaining({ audioContext: f.context }));
    expect(f.context.close).toHaveBeenCalledTimes(1); expect(f.root.audio.stop).toHaveBeenCalledTimes(1); await controller.dispose();
  });
  it('cancels count-in BEGIN on pause, then replaces it on resume', async () => {
    const f = environment(), controller = f.create('MICROPHONE', 1); await controller.start();
    await f.feed(200); controller.pause(); await f.feed(700);
    expect(f.bridge().runtime.snapshot().counts.segmentsStarted).toBe(0);
    expect(controller.snapshot().transport?.state).toBe('PAUSED'); controller.resume(); await f.feed(1800);
    expect(controller.snapshot().session).toBe('COMPLETE');
    expect(f.bridge().snapshot().boundaryDiagnostics.filter(d => d.action === 'CANCELLED').length).toBe(2); await controller.dispose();
  });
  it('preserves a logically reached BEGIN whose source message has not arrived at Pause', async () => {
    const f = environment(), controller = f.create('MICROPHONE', 1); await controller.start();
    await f.feed(480); f.context.currentTime += .030; controller.pause();
    expect(controller.snapshot().transport?.state).toBe('PAUSED'); await f.feed(200);
    expect(controller.snapshot().analysis).toBe('PAUSED'); expect(f.bridge().runtime.snapshot().counts.segmentsStarted).toBe(1);
    const done = controller.finish(); await f.feed(200); await done;
    expect(controller.snapshot().completed?.evaluation.status).toBe('COMPLETE'); await controller.dispose();
  });
  it('cancels stale natural terminal near its boundary and resumes to a new one', async () => {
    const f = environment(), controller = f.create(); await controller.start(); await f.feed(1100); controller.pause();
    const T = controller.snapshot().transport!.performanceTimeMs; await f.feed(500);
    expect(controller.snapshot().transport!.performanceTimeMs).toBe(T); expect(controller.snapshot().session).toBe('ACTIVE');
    controller.resume(); expect(controller.snapshot().transport!.performanceTimeMs).toBe(T); await f.feed(500);
    expect(controller.snapshot().session).toBe('COMPLETE'); expect(f.bridge().runtime.snapshot().analyzedThroughPerformanceMs).toBe(1200); await controller.dispose();
  });
  it('multiple pauses keep exact identity; manual stop drains only tail', async () => {
    const f = environment(), controller = f.create(); await controller.start();
    for (let i = 0; i < 3; i++) {
      await f.feed(180); controller.pause(); const T = controller.snapshot().transport!.performanceTimeMs;
      await f.feed(100); controller.resume(); expect(controller.snapshot().transport!.performanceTimeMs).toBe(T);
    }
    const completion = controller.finish(); expect(controller.snapshot().session).toBe('FINALIZING');
    await f.feed(300); await completion; expect(controller.snapshot().session).toBe('COMPLETE'); await controller.dispose();
  });
  it('Stop during count-in produces zero-domain terminal, no fabricated input', async () => {
    const f = environment(), controller = f.create('MICROPHONE', 1); await controller.start();
    const promise = controller.finish(); await f.feed(50); await promise;
    expect(f.bridge().runtime.snapshot().counts.windowsStarted).toBe(0);
    expect(f.bridge().runtime.snapshot().analyzedThroughPerformanceMs).toBe(0);
    const evaluation = controller.snapshot().completed?.evaluation;
    expect(evaluation?.status).toBe('COMPLETE');
    if (evaluation?.status === 'COMPLETE') expect(evaluation.groups.every(group => group.verdict === 'NOT_REACHED')).toBe(true);
    await controller.dispose();
  });
  for (const paused of [false, true]) it(`analysis failure ${paused ? 'PAUSED' : 'RUNNING'} does not stop clock/root/recording`, async () => {
    const f = environment(), controller = f.create('MICROPHONE', 0, 'AUDIO'); await controller.start(); await f.feed(300);
    if (paused) controller.pause(); f.failure();
    expect(controller.snapshot().analysis).toBe('FAILED'); expect(f.root.audio.stop).not.toHaveBeenCalled(); expect(f.context.close).not.toHaveBeenCalled();
    expect(f.root.copies[0].audio.stop).toHaveBeenCalledTimes(1); expect(f.root.copies[1].audio.stop).not.toHaveBeenCalled();
    const T = controller.snapshot().transport!.performanceTimeMs;
    if (paused) controller.resume(); await f.feed(300);
    expect(controller.snapshot().transport!.performanceTimeMs).toBeGreaterThan(T); expect(controller.snapshot().recording?.state).toBe('RECORDING');
    await controller.finish(); expect(controller.snapshot().completed?.evaluation).toEqual({ status: 'UNAVAILABLE', reason: 'CONTINUOUS_ANALYSIS_UNAVAILABLE' });
    expect(controller.snapshot().completed?.media.status).toBe('READY'); expect(f.root.audio.stop).toHaveBeenCalledTimes(1); await controller.dispose();
  });
  it('recording ON normal completion shares one acquisition and exact pause mapping', async () => {
    const f = environment(), controller = f.create('MICROPHONE', 0, 'AUDIO'); await controller.start();
    await f.feed(500); controller.pause(); const T = controller.snapshot().transport!.performanceTimeMs;
    await f.feed(300); controller.resume(); await f.feed(1000);
    const completed = controller.snapshot().completed!;
    expect(completed.media.status).toBe('READY'); expect(completed.evaluation.status).toBe('COMPLETE');
    expect(completed.recordingTimebase.activeSegments[0].perfEndMs).toBe(T);
    expect(completed.recordingTimebase.activeSegments[1].perfStartMs).toBe(T);
    expect(f.platform.acquireMicrophone).toHaveBeenCalledTimes(1); await controller.dispose();
  });
  it('does not expose COMPLETE or completed truth while Worker cleanup is still pending', async () => {
    const f = environment(); let release: () => void = () => {};
    f.worker.dispose = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const controller = f.create(); await controller.start(); await f.feed(400);
    const completion = controller.finish(); await f.feed(400);
    expect(controller.snapshot().session).toBe('FINALIZING'); expect(controller.snapshot().completed).toBeNull();
    expect(f.root.audio.stop).not.toHaveBeenCalled(); expect(f.context.close).not.toHaveBeenCalled();
    release(); await completion;
    expect(controller.snapshot().session).toBe('COMPLETE'); expect(f.root.audio.stop).toHaveBeenCalledTimes(1);
    expect(f.context.close).toHaveBeenCalledTimes(1); await controller.dispose();
  });
  it('pre-start model failure never begins transport or acquires microphone', async () => {
    const f = environment(); f.platform.modelUrl = async () => { throw new Error('ASSET_FAILURE'); };
    const controller = f.create(); await controller.start(); expect(controller.snapshot().session).toBe('FAILED_BEFORE_START');
    expect(controller.snapshot().transport).toBeNull(); expect(f.platform.acquireMicrophone).not.toHaveBeenCalled(); await controller.dispose();
  });
  it('observes a Worker crash during permission preparation before transport/context start', async () => {
    const f = environment(); f.platform.acquireMicrophone = async () => { f.failure(); return f.root.media; };
    const controller = f.create(); await controller.start();
    expect(controller.snapshot().session).toBe('FAILED_BEFORE_START'); expect(controller.snapshot().transport).toBeNull();
    expect(f.platform.createAudioContext).not.toHaveBeenCalled(); expect(f.root.audio.stop).toHaveBeenCalledTimes(1); await controller.dispose();
  });
  it('unsupported source rate fails before start and releases owned preparation resources', async () => {
    const f = environment(96000), controller = f.create(); await controller.start();
    expect(controller.snapshot().session).toBe('FAILED_BEFORE_START'); expect(controller.snapshot().transport).toBeNull();
    expect(controller.snapshot().analysis).toBe('FAILED'); expect(f.root.audio.stop).toHaveBeenCalledTimes(1);
    expect(f.context.close).toHaveBeenCalledTimes(1); expect(f.worker.dispose).toHaveBeenCalledTimes(1); await controller.dispose();
  });
  it('disposal during unresolved microphone permission stops the late owned root', async () => {
    const f = environment(); let resolve: (stream: MediaStream) => void = () => {};
    f.platform.acquireMicrophone = vi.fn(() => new Promise<MediaStream>(done => { resolve = done; }));
    const controller = f.create(), start = controller.start(); await vi.advanceTimersByTimeAsync(1);
    const dispose = controller.dispose(); resolve(f.root.media); await start; await dispose;
    expect(f.root.audio.stop).toHaveBeenCalledTimes(1); expect(f.platform.createAudioContext).not.toHaveBeenCalled();
  });
  for (const finalizing of [false, true]) it(`dispose during ${finalizing ? 'FINALIZING' : 'RUNNING'} cleans each resource once`, async () => {
    const f = environment(), controller = f.create(); await controller.start(); await f.feed(100);
    if (finalizing) void controller.finish();
    await controller.dispose(); await controller.dispose();
    expect(f.worker.dispose).toHaveBeenCalledTimes(1); expect(f.context.close).toHaveBeenCalledTimes(1); expect(f.root.audio.stop).toHaveBeenCalledTimes(1);
  });
  it('rejects cancellation of an applied boundary and keeps scheduler storage bounded', async () => {
    const f = environment(), controller = f.create(); await controller.start();
    const id = f.bridge().snapshot().boundaryDiagnostics.find(d => d.action === 'APPLIED')!.id;
    expect(() => f.bridge().cancel(id)).toThrow('CAPTURE_BOUNDARY_NOT_PENDING'); expect(controller.snapshot().analysis).toBe('FAILED'); await controller.dispose();
  });
  it('retires 100 cancelled boundary IDs without keeping a tombstone list', async () => {
    const f = environment(), controller = f.create(); await controller.start();
    const bridge = f.bridge(); const natural = bridge.snapshot().boundaryDiagnostics.find(d => d.type === 'TERMINAL')!.id;
    bridge.cancel(natural);
    for (let i = 0; i < 100; i++) {
      const id = bridge.schedule({ type: 'PAUSE', sourceSampleIndex: bridge.snapshot().nextSourceSampleIndex + 128, performanceTimeMs: 0 });
      bridge.cancel(id); expect(bridge.isPending(id)).toBe(false);
    }
    expect(bridge.snapshot().pendingBoundaryCount).toBe(0); expect(bridge.snapshot().boundaryDiagnostics).toHaveLength(32);
    await controller.finish(); await controller.dispose();
  });
});
