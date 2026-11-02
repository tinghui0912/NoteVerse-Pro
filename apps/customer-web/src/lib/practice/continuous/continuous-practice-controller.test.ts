import { continuousMetronomeSyncPoint } from './metronome-sync';
import { metronomeAudioFixture, observeMetronomeRuntime } from '@/lib/practice/__fixtures__/metronome';
import { rootHealthFixture } from '@/lib/practice/__fixtures__/root-health';
import { planPracticeResources } from '@/lib/practice/planning/resource-plan';
import { continuousSessionPlan } from '@/lib/practice/__fixtures__/session-plan';
import { artifactWithKeys } from '../__fixtures__/piano-key-artifact';
import { ContinuousPracticeSession } from './domain/practice-session';
import { ContinuousMicrophoneInput } from './continuous-microphone-input';
import { completedContinuousTargetFeedback } from './domain/evaluation/target-feedback';
import { ContinuousAssignmentFinalizer } from './domain/evaluation/assignment-finalizer';
import { PracticeResourceBinding } from '../device/practice-resource-binding';
import { borrowedDevices } from '../__fixtures__/device-roots';
import type { AcousticInferencePort } from '@/lib/practice/acoustic/runtime/inference-types';
import { PracticeEnvironment } from '@/lib/practice/environment/practice-environment';
import { AcousticEngine } from '@/lib/practice/acoustic/model/acoustic-engine';
import { workerRpcRig } from '@/lib/practice/acoustic/model/__fixtures__/worker-rpc';
import { ACOUSTIC_WORKER_RPC_SILENCE_TIMEOUT_MS as SILENCE } from '@/lib/practice/acoustic/model/worker-liveness-policy';
import { microphoneEvidenceProvenance } from '@/lib/practice/result/continuous-result-provenance';
import { sourceIdentity, ACOUSTIC_MODEL } from '@/lib/practice/acoustic/model/model-contract';
import { CONTINUOUS_ASSIGNMENT_POLICY_ID } from '@/lib/practice/continuous/domain/evaluation/finalization-policy';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { ManualClock } from '@/lib/practice/kernel/timebase';
import { ContinuousPracticeController } from './continuous-practice-controller';
import type { ContinuousPlatform } from './continuous-input';
import type { ContinuousEvidencePublication } from './domain/evaluation/evidence-types';
import type { ContinuousCaptureBridge } from '../acoustic/continuous/capture-bridge';
import type { BrowserMidiControllerOptions } from '../midi/browser-midi-controller';
import { performanceTakesApi } from '@/lib/api/performance-takes';
import { PerformanceRecorder } from '../recording/performance-recorder';
import { ContinuousMidiEvidence } from './input/midi-evidence';
import * as scopeContract from '../kernel/scope';
import * as tempoContract from '../kernel/tempo';

function track(kind = 'audio') {
  const events = new EventTarget();
  let state = 'live'; return { kind, muted: false, get readyState() { return state; },
    stop: vi.fn(() => { state = 'ended'; events.dispatchEvent(new Event('ended')); }),
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events) };
}
type TestStream = { media: MediaStream; audio: ReturnType<typeof track>; copies: TestStream[] };
function stream(video = false): TestStream {
  const audio = track(), tracks = video ? [audio, track('video')] : [audio]; const copies: TestStream[] = [];
  const media = { getTracks: () => tracks, getAudioTracks: () => [audio], getVideoTracks: () => tracks.filter(t => t.kind === 'video'),
    clone: () => { const copy = stream(video); copies.push(copy); return copy.media; } } as unknown as MediaStream;
  return { media, audio, copies };
}
class Recorder {
  static isTypeSupported() { return true; }
  state = 'inactive'; mimeType = 'audio/webm';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null; onerror: (() => void) | null = null;
  start() { this.state = 'recording'; } pause() { this.state = 'paused'; } resume() { this.state = 'recording'; }
  requestData() { this.ondataavailable?.({ data: new Blob(['recording']) }); }
  stop() { this.state = 'inactive'; this.onstop?.(); }
}
function environment(rate = 48000, root = stream(), blockSamples = 128, recordingRoot = root.media) {
  const clock = new ManualClock(0), health = rootHealthFixture();
  let frame = 0, sequence = 0, bridge: ContinuousCaptureBridge | undefined, captureStopped = false;
  let fail: ((error: Error) => void) | undefined;
  let runs = 0, midiOptions: BrowserMidiControllerOptions | undefined;
  const events = new EventTarget();
  const context = { currentTime: 0, sampleRate: rate, state: 'running',
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    resume: vi.fn(async () => {}), close: vi.fn(async () => { context.state = 'closed'; events.dispatchEvent(new Event('statechange')); }) };
  const worker: AcousticInferencePort = {
    run: vi.fn(async () => ({ events: [], inferenceMs: 0, decodeMs: 0, actualSessionRunCount: ++runs })),
    dispose: vi.fn(async () => {}), onFailure: listener => { fail = listener; return () => { fail = undefined; }; } };
  const meter = observeMetronomeRuntime();
  const platform: ContinuousPlatform = {
    midiClock: clock, acquireInference: vi.fn(async () => worker),
    createAudioContext: vi.fn(() => context as unknown as AudioContext),
    coefficients: async sourceRate => {
      if (sourceRate !== 44100 && sourceRate !== 48000) throw new Error('SOURCE_SAMPLE_RATE_NOT_QUALIFIED');
      return new Uint8Array(readFileSync(`public/model-assets/practice-acoustic/${sourceRate === 44100 ? 'fir-160-441' : 'fir-1-3'}.f32`));
    }, workletUrl: '/worklet',
    connectCapture: async options => {
      expect(options.context).toBe(context);
      bridge = options.bridge; const clone = options.stream.clone();
      const stop = vi.fn(() => { if (captureStopped) return; captureStopped = true; detach(); clone.getTracks().forEach(t => t.stop()); });
      const detach = bridge.runtime.attachCaptureCleanup(stop);
      await feed(1800); return { stop };
    },
    createMidi: vi.fn(options => { midiOptions = options; return { start: async () => {}, dispose: vi.fn(),
      refreshInputs: vi.fn() }; }),
    createRecorder: vi.fn(mode => new PerformanceRecorder(mode)), createMetronomeAudio: vi.fn(() => metronomeAudioFixture()),
  };
  let controller: ContinuousPracticeController | undefined;
  async function feed(ms: number) {
    const end = frame + Math.ceil(ms / 1000 * rate / blockSamples) * blockSamples;
    while (frame < end && context.state !== 'closed') {
      const start = frame; frame += blockSamples; context.currentTime = Math.max(context.currentTime, frame / rate);
      if (!captureStopped && bridge) bridge.receive({ type: 'pcm-chunk', sequence: sequence++, sourceSampleRateHz: rate,
        sourceStartSampleIndex: start, sourceEndSampleIndex: frame, audioContextStartFrame: start,
        captureTimeSeconds: start / rate, inputChannelCount: 1, samples: new Float32Array(blockSamples) });
      controller?.refresh(); await vi.advanceTimersByTimeAsync(1);
    }
    await vi.advanceTimersByTimeAsync(10);
  }
  function create(inputSource: 'MIDI' | 'MICROPHONE' = 'MICROPHONE', countInBeats = 0, recordingMode: 'OFF' | 'AUDIO' | 'VIDEO' = 'OFF', onNaturalCompletion = vi.fn(), cameraStream?: MediaStream, scoreEndBeat = 2.4, meterDenominator = 4) {
    const base = artifactWithKeys([[60]]);
    base.events[0].durationBeats = scoreEndBeat; base.moments[0].canonicalEndBeat = scoreEndBeat;
    const artifact: PracticeScoreArtifact = { ...base, scoreEndBeat,
      ...(meterDenominator === 4 ? {} : { meterSegments: [{ startBeat: 0, numerator: 1, denominator: meterDenominator,   }] }),
    };
    controller = new ContinuousPracticeController({ rootHealth: health.port, plan: continuousSessionPlan(artifact, { scope: { kind: 'FULL' }, inputSource: inputSource, tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm: 120 }, recordingMode: recordingMode }), countInBeats, onNaturalCompletion, devices: borrowedDevices(root.media, recordingRoot, cameraStream ?? null) }, platform);
    return controller;
  }
  return { health, create, platform, root, context, clock, worker, meter, feed, failure: () => fail?.(new Error('TEST_WORKER_FAILURE')),
    bridge: () => bridge!, midiOptions: () => midiOptions! };
}

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('MediaRecorder', Recorder);
  vi.stubGlobal('MediaStream', class { constructor(private tracks: MediaStreamTrack[]) {}
    getTracks() { return this.tracks; } getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); }
    getVideoTracks() { return this.tracks.filter(t => t.kind === 'video'); }
    clone() { return stream(this.getVideoTracks().length > 0).media; }
  }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('Continuous application owner', () => {
  it('MIDI physical loss and recovery retain session/evaluation and require explicit recovery', async () => {
    const f = environment(), controller = f.create('MIDI'); await controller.start();
    f.clock.set(50); controller.refresh(); const before = controller.engineeringSnapshot().sessionId;
    const position = controller.snapshot().transport!.performanceTimeMs;
    f.health.set('midi', 'LOST');
    expect(controller.snapshot()).toMatchObject({ session: 'ACTIVE', inputError: 'NO_CONNECTED_INPUT', transport: { state: 'PAUSED' },
      resourceIntervention: { impact: 'INPUT_REQUIRED', state: 'WAITING_FOR_USER' }, completed: null });
    f.clock.advance(100); f.health.set('midi', 'HEALTHY');
    expect(controller.snapshot()).toMatchObject({ inputError: null, transport: { state: 'PAUSED', performanceTimeMs: position },
      resourceIntervention: { state: 'RECOVERED_WAITING_FOR_USER' } });
    expect(controller.engineeringSnapshot().sessionId).toBe(before);
    expect(controller.continueAfterRecovery()).toBe(true); expect(controller.snapshot().transport?.state).not.toBe('PAUSED');
    expect(f.platform.createMidi).toHaveBeenCalledOnce();
    await controller.dispose(); expect(f.health.listenerCount()).toBe(0);
  });
  it('rejects physical MIDI loss between binding and Start with the input failure owner', async () => {
    const f = environment(), controller = f.create('MIDI');
    vi.mocked(f.platform.createMetronomeAudio).mockImplementationOnce(() => {
      f.health.set('midi', 'LOST'); return metronomeAudioFixture();
    });
    await controller.start();
    expect(controller.snapshot()).toMatchObject({ session: 'FAILED_BEFORE_START', inputError: 'NO_CONNECTED_INPUT', completed: null });
    expect(f.health.listenerCount()).toBe(0); await controller.dispose();
  });
  it('real DeviceLease alone observes recording-only microphone and camera roots', async () => {
    const microphone = stream(), camera = stream(true), midi = borrowedDevices().midi!;
    const physicalTrack = microphone.media.getAudioTracks()[0], listen = vi.spyOn(physicalTrack, 'addEventListener');
    const lease = new PracticeResourceBinding(planPracticeResources({ mode: 'CONTINUOUS_PLAY', inputSource: 'MIDI', recordingMode: 'VIDEO' }), {
      acquireMidi: async () => midi, acquireStream: async name => name === 'camera' ? camera.media : microphone.media,
    });
    await lease.open(); const f = environment();
    const controller = new ContinuousPracticeController({ devices: lease.snapshot().roots, rootHealth: lease.rootHealth,
      plan: continuousSessionPlan(artifactWithKeys([[60]]), { recordingMode: 'VIDEO' }), countInBeats: 0 }, f.platform);
    try {
      await controller.start(); expect(listen.mock.calls.map(([event]) => event)).toEqual(['mute', 'unmute', 'ended']);
      microphone.audio.muted = true; microphone.audio.dispatchEvent(new Event('mute'));
      expect(Reflect.get(controller, 'recorder').runtimeFault()).toMatchObject({ reason: 'AUDIO_TRACK_MUTED', recoverability: 'SAME_PIPELINE_RECOVERABLE' });
      microphone.audio.muted = false; microphone.audio.dispatchEvent(new Event('unmute'));
      expect(controller.snapshot().resourceIntervention?.state).toBe('RECOVERED_WAITING_FOR_USER');
      expect(controller.continueAfterRecovery()).toBe(true);
      // The video physical track is distinct from the unused audio track on the camera fixture.
      const video = camera.media.getVideoTracks()[0]; Object.assign(video, { muted: true }); video.dispatchEvent(new Event('mute'));
      expect(Reflect.get(controller, 'recorder').runtimeFault()?.reason).toBe('VIDEO_TRACK_MUTED');
      expect(f.platform.acquireInference).not.toHaveBeenCalled();
    } finally { await controller.dispose(); lease.close(); }
  });
  it.each([
    ['MICROPHONE', 'AUDIO', 'inputMicrophone'],
    ['MICROPHONE', 'VIDEO', 'inputMicrophone'],
    ['MIDI', 'AUDIO', 'recordingMicrophone'],
    ['MIDI', 'VIDEO', 'recordingMicrophone'],
  ] as const)('%s %s binds recorder and analysis to the planned roots', async (inputSource, mode, audioRoot) => {
    const input = stream(), recording = stream(), camera = stream(true);
    const f = environment(48000, input, 128, recording.media);
    const prepare = vi.spyOn(PerformanceRecorder.prototype, 'prepare');
    const controller = f.create(inputSource, 0, mode, vi.fn(), camera.media);
    try {
      await controller.start(); expect(controller.snapshot().session).toBe('ACTIVE');
      expect(f.platform.createRecorder).toHaveBeenCalledExactlyOnceWith(mode);
      expect(prepare).toHaveBeenCalledExactlyOnceWith({
        audioRoot: audioRoot === 'inputMicrophone' ? input.media : recording.media,
        cameraStream: mode === 'VIDEO' ? camera.media : null,
      });
      expect(f.platform.acquireInference).toHaveBeenCalledTimes(inputSource === 'MICROPHONE' ? 1 : 0);
      expect(f.platform.createAudioContext).toHaveBeenCalledTimes(inputSource === 'MICROPHONE' ? 1 : 0);
      if (inputSource === 'MICROPHONE') {
        expect(f.root).toBe(input); expect(recording.copies).toHaveLength(0);
      } else {
        expect(f.platform.createMidi).toHaveBeenCalledOnce(); expect(input.copies).toHaveLength(0);
      }
    } finally { await controller.dispose(); prepare.mockRestore(); }
  });
  it('live metronome control preserves the executed scope, tempo, owner and transport', async () => {
    const f = environment(), controller = f.create('MIDI');
    const resolveScope = vi.spyOn(scopeContract, 'resolvePracticeScope');
    const resolveTempo = vi.spyOn(tempoContract, 'resolvePracticeTempoPlan');
    try {
      await controller.start();
      f.clock.set(50); controller.refresh();
      expect(controller.snapshot().session).toBe('ACTIVE');
      const session: ContinuousPracticeSession = Reflect.get(controller, 'session');
      const before = session.snapshotSession(), transport = controller.snapshot().transport;
      controller.setMetronomeEnabled(true);
      const after = session.snapshotSession();
      expect(Reflect.get(controller, 'session')).toBe(session);
      expect(after.localSessionId).toBe(before.localSessionId);
      expect(after.scope).toBe(before.scope); expect(after.tempoPlan).toBe(before.tempoPlan);
      expect(after.metronomeEnabled).toBe(true);
      expect(controller.snapshot().transport).toEqual(transport);
      expect(f.platform.createMidi).toHaveBeenCalledOnce();
      expect(f.platform.createMetronomeAudio).toHaveBeenCalledOnce();
      expect(f.meter.dispose).not.toHaveBeenCalled();
      expect(f.meter.setEnabled).toHaveBeenLastCalledWith(true);
      expect(Reflect.get(f.meter.start.mock.instances[0] as object, 'plan')).toBe(Reflect.get(controller, 'options').plan.metronomePlan);
      expect(f.meter.syncContinuous).toHaveBeenLastCalledWith(continuousMetronomeSyncPoint(transport!));
      expect(resolveScope).not.toHaveBeenCalled(); expect(resolveTempo).not.toHaveBeenCalled();
    } finally { await controller.dispose(); resolveScope.mockRestore(); resolveTempo.mockRestore(); }
  });
  it('controller snapshots never publish MIDI evidence; explicit refresh catches semantic needs up once', async () => {
    const cover = vi.spyOn(ContinuousMidiEvidence.prototype, 'cover');
    const f = environment(), controller = f.create('MIDI');
    try {
      await controller.start();
      const before = controller.snapshot().evaluation;
      f.clock.set(600);
      for (let i = 0; i < 100; i++) controller.snapshot();
      expect(cover).not.toHaveBeenCalled();
      expect(controller.snapshot().evaluation).toEqual(before);
      controller.refresh();
      expect(cover).toHaveBeenCalledExactlyOnceWith(250, 500);
      expect(controller.snapshot().evaluation?.targets[0].state).toBe('UNMATCHED');
      for (let i = 0; i < 100; i++) { controller.snapshot(); controller.refresh(); }
      expect(cover).toHaveBeenCalledOnce();
      await controller.abandon();
      expect(controller.snapshot().completed).toBeNull();
    } finally { await controller.dispose(); cover.mockRestore(); }
  });
  for (const mode of ['OFF', 'AUDIO', 'VIDEO'] as const) for (const event of ['mute', 'ended'] as const) {
    it(`root ${event} with ${mode} requires input, never recording-only degradation`, async () => {
      const f = environment(), camera = mode === 'VIDEO' ? stream(true).media : undefined;
      const controller = f.create('MICROPHONE', 0, mode, vi.fn(), camera); await controller.start(); await f.feed(100);
      if (event === 'mute') { f.root.audio.muted = true; f.root.audio.dispatchEvent(new Event('mute')); f.health.set('inputMicrophone', 'INTERRUPTED'); } else { f.root.audio.stop(); f.health.set('inputMicrophone', 'LOST'); }
      const paused = controller.snapshot(); expect(paused.session).toBe('ACTIVE'); expect(paused.transport?.state).toBe('PAUSED');
      expect(paused.resourceIntervention).toMatchObject({ impact: mode === 'OFF' ? 'INPUT_REQUIRED' : 'INPUT_AND_RECORDING',
        recoverability: event === 'mute' ? 'SAME_PIPELINE_RECOVERABLE' : 'RESTART_REQUIRED', state: 'WAITING_FOR_USER' });
      expect(paused.analysisError).toBeNull(); expect(f.worker.dispose).not.toHaveBeenCalled();
      controller.continueWithoutRecording(); expect(controller.snapshot().resourceIntervention).not.toBeNull();
      await f.feed(200); expect(controller.snapshot().transport?.performanceTimeMs).toBe(paused.transport?.performanceTimeMs);
      if (event === 'mute') {
        f.root.audio.muted = false; f.root.audio.dispatchEvent(new Event('unmute')); f.health.set('inputMicrophone', 'HEALTHY');
        expect(controller.snapshot().resourceIntervention?.state).toBe('RECOVERED_WAITING_FOR_USER');
        expect(controller.snapshot().transport?.state).toBe('PAUSED'); expect(controller.continueAfterRecovery()).toBe(true);
        expect(controller.snapshot().transport).toMatchObject({ state: 'COUNT_IN', countInKind: 'RESUME' });
      } else expect(controller.continueAfterRecovery()).toBe(false);
      await controller.abandon(); await controller.dispose();
      expect(f.worker.dispose).toHaveBeenCalledOnce(); expect(f.context.close).toHaveBeenCalledOnce();
    });
  }
  for (const state of ['suspended', 'interrupted', 'closed']) for (const paused of [false, true]) {
    it(`context ${state} preserves canonical ${paused ? 'user pause' : 'intervention pause'} ownership`, async () => {
      const f = environment(), controller = f.create(); await controller.start(); if (paused) controller.pause();
      f.context.state = state; f.context.dispatchEvent(new Event('statechange'));
      expect(controller.snapshot().session).toBe('ACTIVE'); expect(controller.snapshot().transport?.state).toBe('PAUSED');
      expect(controller.snapshot().resourceIntervention).toMatchObject({ impact: 'INPUT_REQUIRED',
        recoverability: state === 'closed' ? 'RESTART_REQUIRED' : 'SAME_PIPELINE_RECOVERABLE' });
      controller.continueWithoutRecording(); expect(controller.snapshot().transport?.state).toBe('PAUSED');
      if (state !== 'closed') {
        f.context.state = 'running'; f.context.dispatchEvent(new Event('statechange'));
        expect(controller.snapshot().resourceIntervention?.state).toBe('RECOVERED_WAITING_FOR_USER');
        expect(controller.continueAfterRecovery()).toBe(true);
        expect(controller.snapshot().transport?.state).toBe(paused ? 'PAUSED' : 'COUNT_IN');
      }
      expect(controller.snapshot().completed).toBeNull(); await controller.abandon(); await controller.dispose();
    });
  }
  for (const first of ['input', 'recording'] as const) it(`dual fault (${first} first) has one input-required intervention and one pause`, async () => {
    const f = environment(), controller = f.create('MICROPHONE', 0, 'AUDIO'); await controller.start(); await f.feed(100);
    const clone = f.root.copies.at(-1)!;
    const input = () => { f.root.audio.muted = true; f.root.audio.dispatchEvent(new Event('mute')); f.health.set('inputMicrophone', 'INTERRUPTED'); };
    const recording = () => { clone.audio.muted = true; clone.audio.dispatchEvent(new Event('mute')); };
    if (first === 'input') { input(); recording(); } else { recording(); input(); }
    expect(f.meter.pause).toHaveBeenCalledOnce(); expect(controller.snapshot().resourceIntervention?.impact).toBe('INPUT_AND_RECORDING');
    controller.continueWithoutRecording(); expect(controller.snapshot().transport?.state).toBe('PAUSED');
    f.root.audio.muted = false; f.root.audio.dispatchEvent(new Event('unmute')); f.health.set('inputMicrophone', 'HEALTHY');
    expect(controller.snapshot().resourceIntervention?.state).toBe('WAITING_FOR_USER');
    clone.audio.muted = false; clone.audio.dispatchEvent(new Event('unmute'));
    expect(controller.snapshot().resourceIntervention?.state).toBe('RECOVERED_WAITING_FOR_USER');
    expect(controller.continueAfterRecovery()).toBe(true); await controller.abandon(); await controller.dispose();
  });
  it('a capture failure raised synchronously while pausing a recording incident takes input priority', async () => {
    const f = environment(), controller = f.create('MICROPHONE', 0, 'AUDIO'); await controller.start(); await f.feed(100);
    const bridge = f.bridge(), schedule = bridge.schedule.bind(bridge);
    vi.spyOn(bridge, 'schedule').mockImplementation(boundary => {
      if (boundary.type === 'PAUSE') { bridge.abort(new Error('CAPTURE_PIPELINE_INVALID')); throw new Error('CAPTURE_PIPELINE_INVALID'); }
      return schedule(boundary);
    });
    const clone = f.root.copies.at(-1)!; clone.audio.muted = true; clone.audio.dispatchEvent(new Event('mute'));
    expect(controller.snapshot().resourceIntervention).toMatchObject({ impact: 'INPUT_AND_RECORDING', reason: 'CAPTURE_PIPELINE_INVALID', recoverability: 'RESTART_REQUIRED' });
    expect(f.meter.pause).toHaveBeenCalledOnce(); controller.continueWithoutRecording(); expect(controller.snapshot().transport?.state).toBe('PAUSED');
    expect(controller.snapshot().completed).toBeNull(); await controller.abandon(); await controller.dispose();
  });
  it('required input loss during unfinished natural tail cannot publish trustworthy completed truth', async () => {
    const f = environment(), controller = f.create(); await controller.start(); await f.feed(100);
    f.context.currentTime += 1.2; controller.refresh(); const finishing = controller.abandon(); f.root.audio.stop(); f.health.set('inputMicrophone', 'LOST');
    await finishing; expect(controller.snapshot().session).toBe('FAILED'); expect(controller.snapshot().completed).toBeNull(); await controller.dispose();
  });
  for (const fault of ['worker-dispose', 'context-close', 'recorder-stop', 'recorder-stop-reject', 'recorder-finalize-throw', 'recorder-finalize', 'recorder-cleanup']) {
    it(`settles ${fault} failure without COMPLETE, unhandled rejection or double cleanup`, async () => {
      const f = environment(); const recorder = new PerformanceRecorder('AUDIO');
      f.platform.createRecorder = () => recorder;
      const controller = f.create('MICROPHONE', 0, 'AUDIO'); await controller.start(); await f.feed(100);
      if (fault === 'worker-dispose') f.worker.dispose = vi.fn(async () => { throw new Error('dispose rejected'); });
      if (fault === 'context-close') f.context.close = vi.fn(async () => { throw new Error('close rejected'); });
      if (fault === 'recorder-stop') recorder.freeze = () => { throw new Error('RECORDER_STOP_FAILED'); };
      if (fault === 'recorder-stop-reject') recorder.freeze = async () => { throw new Error('RECORDER_STOP_FAILED'); };
      if (fault === 'recorder-finalize-throw') recorder.finalize = () => { throw new Error('RECORDER_FINALIZE_FAILED'); };
      if (fault === 'recorder-finalize') recorder.finalize = async () => { throw new Error('RECORDER_FINALIZE_FAILED'); };
      if (fault === 'recorder-cleanup') {
        const release = recorder.stopAndCleanup.bind(recorder);
        recorder.stopAndCleanup = () => { release(); throw new Error('RECORDER_CLEANUP_FAILED'); };
      }
      await f.feed(1200);
      const completion = controller.abandon(); await f.feed(400); await completion;
      expect(controller.snapshot().session).toBe('FAILED'); expect(controller.snapshot().completed).toBeNull();
      expect(f.root.audio.stop).not.toHaveBeenCalled();
      expect(f.worker.dispose).toHaveBeenCalledTimes(1); expect(f.context.close).toHaveBeenCalledTimes(1);
      await controller.dispose(); expect(f.worker.dispose).toHaveBeenCalledTimes(1);
    });
  }
  it('fresh controller after fatal source loss uses fresh owned resources', async () => {
    const first = environment(), failed = first.create(); await failed.start();
    first.root.audio.stop(); first.health.set('inputMicrophone', 'LOST'); await first.feed(5); await failed.dispose();
    const next = environment(), fresh = next.create(); await fresh.start(); await next.feed(1600);
    expect(fresh.snapshot().session).toBe('COMPLETE'); expect(next.worker).not.toBe(first.worker);
    expect(next.context).not.toBe(first.context); await fresh.dispose();
  });
  it('MIDI natural completion owns one evaluation without acoustic dependencies', async () => {
    const authorize = vi.spyOn(performanceTakesApi, 'reserveUpload');
    const finalize = vi.spyOn(performanceTakesApi, 'finalizeTake');
    const f = environment(), controller = f.create('MIDI'); await controller.start();
    f.clock.set(1201); controller.refresh(); await controller.abandon();
    expect(controller.snapshot().completed?.result.evaluation.status).toBe('COMPLETE');
    expect(f.platform.acquireInference).not.toHaveBeenCalled(); expect(f.platform.createAudioContext).not.toHaveBeenCalled();
    expect(f.platform.createAudioContext).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled(); expect(finalize).not.toHaveBeenCalled();
    await controller.dispose(); authorize.mockRestore(); finalize.mockRestore();
  });
  it('MIDI AUDIO fails before Start when its borrowed recording root is lost', async () => {
    const getUserMedia = vi.fn(async () => { throw new DOMException('private browser detail', 'NotAllowedError'); });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const callback = vi.fn();
    const f = environment(); f.root.audio.stop(); const controller = f.create('MIDI', 4, 'AUDIO', callback);
    try {
      await controller.start();
      expect(controller.snapshot()).toMatchObject({ session: 'FAILED_BEFORE_START', transport: null,
        completed: null, evaluation: null, inputError: 'RECORDING_PREPARATION_FAILED', analysisError: null });
      expect(controller.snapshot().recording).toMatchObject({ state: 'PREPARATION_FAILED', sourceOwnership: 'NONE' });
      expect(getUserMedia).not.toHaveBeenCalled();
      expect(f.platform.createMidi).toHaveBeenCalledOnce();
      expect(vi.mocked(f.platform.createMidi).mock.results[0].value.dispose).toHaveBeenCalledOnce();
      expect(f.platform.createAudioContext).not.toHaveBeenCalled();
      expect(f.platform.acquireInference).not.toHaveBeenCalled();
      expect(f.platform.createAudioContext).not.toHaveBeenCalled();
      expect(f.platform.createMetronomeAudio).not.toHaveBeenCalled();
      f.clock.set(10000); controller.refresh();
      expect(controller.snapshot().completed).toBeNull(); expect(callback).not.toHaveBeenCalled();
    } finally { await controller.dispose();  }
  });

  it('MIDI AUDIO track loss after Start preserves evaluation and completes with unavailable recording', async () => {
    const recording = stream();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => recording.media) } });
    const f = environment(), controller = f.create('MIDI', 0, 'AUDIO');
    await controller.start(); expect(controller.snapshot().session).toBe('ACTIVE');
    f.root.copies.at(-1)!.audio.stop();
    expect(controller.snapshot().session).toBe('ACTIVE');
    expect(controller.snapshot().transport?.state).toBe('PAUSED');
    expect(controller.snapshot().resourceIntervention).toMatchObject({ reason: 'AUDIO_TRACK_ENDED', recoverability: 'RESTART_REQUIRED' });
    const watermark = controller.snapshot().transport!.performanceTimeMs;
    f.clock.set(5000); controller.refresh(); expect(controller.snapshot().transport!.performanceTimeMs).toBe(watermark);
    expect(controller.snapshot().completed).toBeNull(); controller.continueWithoutRecording();
    expect(controller.snapshot().resourceIntervention).toBeNull();
    expect(controller.snapshot().analysisError).toBeNull();
    f.clock.set(5000 + controller.snapshot().transport!.countInRemainingMs + 1201); controller.refresh(); await controller.abandon();
    expect(controller.snapshot().session).toBe('COMPLETE');
    expect(controller.snapshot().completed?.result.evaluation.status).toBe('COMPLETE');
    expect(controller.snapshot().completed?.recording).toEqual({ status: 'UNAVAILABLE', reason: 'AUDIO_TRACK_ENDED' });
     expect(controller.snapshot().completed).not.toBeNull();
    await controller.dispose();
  });

  for (const manualPause of [false, true]) it(`recording mute preserves ${manualPause ? 'user' : 'intervention'} pause ownership and requires explicit healthy recovery`, async () => {
    const recording = stream(); vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => recording.media } });
    const f = environment(), callback = vi.fn(), controller = f.create('MIDI', 0, 'AUDIO', callback);
    await controller.start(); f.clock.set(100); controller.refresh(); if (manualPause) controller.pause();
    const evaluation = controller.snapshot().evaluation;
    f.root.copies.at(-1)!.audio.muted = true; f.root.copies.at(-1)!.audio.dispatchEvent(new Event('mute'));
    f.root.copies.at(-1)!.audio.dispatchEvent(new Event('mute'));
    expect(controller.snapshot().resourceIntervention).toMatchObject({ pauseOrigin: manualPause ? 'USER' : 'INTERVENTION', state: 'WAITING_FOR_USER' });
    expect(f.meter.pause).toHaveBeenCalledOnce(); expect(controller.snapshot().transport?.state).toBe('PAUSED');
    f.clock.set(5000); controller.refresh(); expect(controller.snapshot().transport?.performanceTimeMs).toBe(100);
    expect(controller.snapshot().evaluation).toEqual(evaluation); expect(callback).not.toHaveBeenCalled();
    expect(controller.continueAfterRecovery()).toBe(false);
    f.root.copies.at(-1)!.audio.muted = false; f.root.copies.at(-1)!.audio.dispatchEvent(new Event('unmute')); expect(controller.snapshot().transport?.state).toBe('PAUSED');
    expect(controller.continueAfterRecovery()).toBe(true);
    expect(controller.snapshot().transport?.state).toBe(manualPause ? 'PAUSED' : 'COUNT_IN');
    if (manualPause) controller.resume();
    expect(controller.snapshot().transport?.performanceTimeMs).toBe(100);
    expect(f.platform.createMidi).toHaveBeenCalledOnce(); expect(controller.snapshot().analysisError).toBeNull();
    f.clock.set(5000 + controller.snapshot().transport!.countInRemainingMs + 1200); controller.refresh(); await controller.abandon();
    expect(controller.snapshot().completed?.recording.status).toBe('READY'); expect(callback).toHaveBeenCalledOnce(); await controller.dispose();
  });
  it('explicit no-recording acceptance while user-paused never resumes transport', async () => {
    const recording = stream(); vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => recording.media } });
    const f = environment(), controller = f.create('MIDI', 0, 'AUDIO'); await controller.start(); controller.pause();
    f.root.copies.at(-1)!.audio.stop(); expect(controller.continueAfterRecovery()).toBe(false);
    controller.continueWithoutRecording(); expect(controller.snapshot().transport?.state).toBe('PAUSED');
    await controller.abandon(); expect(controller.snapshot().completed).toBeNull(); await controller.dispose();
  });
  it('count-in interruption pauses the canonical clock; End discards and late faults cannot revive it', async () => {
    const recording = stream(); vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => recording.media } });
    const f = environment(), callback = vi.fn(), controller = f.create('MIDI', 4, 'AUDIO', callback);
    await controller.start(); f.root.copies.at(-1)!.audio.stop(); expect(controller.snapshot().transport?.state).toBe('PAUSED');
    expect(controller.snapshot().resourceIntervention).not.toBeNull();
    await controller.abandon(); await controller.dispose(); f.root.copies.at(-1)!.audio.dispatchEvent(new Event('mute'));
    f.clock.set(20000); controller.refresh(); expect(controller.snapshot().completed).toBeNull();
    expect(controller.snapshot().resourceIntervention).toBeNull(); expect(callback).not.toHaveBeenCalled();
  });
  it('microphone recording clone fault freezes evidence at the canonical pause boundary without disposing the warm lease', async () => {
    const f = environment(), controller = f.create('MICROPHONE', 0, 'AUDIO'); await controller.start(); await f.feed(100);
    const recorderClone = f.root.copies.at(-1)!; recorderClone.audio.muted = true; recorderClone.audio.dispatchEvent(new Event('mute'));
    const paused = controller.snapshot(); expect(paused.transport?.state).toBe('PAUSED');
    expect(paused.analysisError).toBeNull(); expect(f.worker.dispose).not.toHaveBeenCalled();
    await f.feed(200); expect(controller.snapshot().transport?.performanceTimeMs).toBe(paused.transport?.performanceTimeMs);
    expect(controller.snapshot().evaluation?.targets).toEqual(paused.evaluation?.targets);
    // Outstanding evidence may finish only through the already captured running interval.
    expect(controller.snapshot().evaluation).not.toHaveProperty('assignment');
    recorderClone.audio.muted = false; recorderClone.audio.dispatchEvent(new Event('unmute')); expect(controller.continueAfterRecovery()).toBe(true);
    await controller.abandon(); expect(controller.snapshot().completed).toBeNull(); await controller.dispose();
  });
  it('natural completion latch wins a late recorder fault without an interruption or second completion', async () => {
    const recording = stream(); vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => recording.media } });
    const f = environment(), callback = vi.fn(), controller = f.create('MIDI', 0, 'AUDIO', callback);
    await controller.start(); f.clock.set(1201); controller.refresh(); f.root.copies.at(-1)!.audio.stop();
    await controller.abandon(); expect(controller.snapshot().session).toBe('COMPLETE');
    expect(controller.snapshot().resourceIntervention).toBeNull(); expect(callback).toHaveBeenCalledOnce(); await controller.dispose();
  });

  for (const input of ['MIDI', 'MICROPHONE'] as const) for (const kind of ['audio', 'video']) {
    it(input + ' VIDEO rejects a preview track that died before admission without acoustic misclassification', async () => {
      const f = environment(), camera = stream(true), callback = vi.fn();
      camera.media.getTracks().find(track => track.kind === kind)!.stop();
      const controller = f.create(input, 4, 'VIDEO', callback, camera.media);
      await controller.start();
      // Recording audio always comes from its dedicated audio root, never camera audio.
      if (kind === 'audio') {
        expect(controller.snapshot().session).toBe('ACTIVE');
        await controller.abandon();
      } else {
        expect(controller.snapshot()).toMatchObject({ session: 'FAILED_BEFORE_START', transport: null,
          completed: null, evaluation: null, analysisError: null, inputError: 'RECORDING_PREPARATION_FAILED' });
        expect(callback).not.toHaveBeenCalled();
      }
      if (input === 'MICROPHONE') {
        expect(f.worker.dispose).toHaveBeenCalledOnce(); expect(f.root.audio.stop).not.toHaveBeenCalled();
        expect(f.context.close).toHaveBeenCalledOnce();
      }
      await controller.dispose();
    });
  }

  it('microphone recorder initialization failure releases its warm lease without analysis failure or model disposal', async () => {
    const f = environment(), worker = {
      load: vi.fn(async () => ({})), beginSession: vi.fn(async (_token: string) => {}), endSession: vi.fn(async () => {}),
      run: async (_token: string, input: Parameters<AcousticInferencePort['run']>[0]) => ({ events: [], inferenceMs: 0, decodeMs: 0, actualSessionRunCount: input.window.jobIndex + 1 }),
      dispose: vi.fn(async () => {}), terminate: vi.fn(), onFailure: () => () => {},
    }, engine = new AcousticEngine(() => worker);
    await engine.prepare('/model');
    f.platform.acquireInference = signal => engine.acquire(signal);
    vi.stubGlobal('MediaRecorder', class { constructor() { throw new Error('private initialization detail'); } });
    const controller = f.create('MICROPHONE', 4, 'AUDIO'); await controller.start();
    expect(controller.snapshot()).toMatchObject({ session: 'FAILED_BEFORE_START', transport: null,
      completed: null, evaluation: null, analysisError: null, inputError: 'RECORDING_PREPARATION_FAILED' });
    expect(f.root.audio.stop).not.toHaveBeenCalled(); expect(f.context.close).toHaveBeenCalledOnce();
    expect(f.root.copies.every(copy => copy.audio.stop.mock.calls.length === 1)).toBe(true);
    expect(engine.snapshot().state).toBe('READY_IDLE');
    const next = await engine.acquire(); await next.dispose();
    expect(worker.load).toHaveBeenCalledOnce(); expect(worker.dispose).not.toHaveBeenCalled();
    await controller.dispose(); await engine.dispose(); expect(worker.dispose).toHaveBeenCalledOnce();
  });

  it('rechecks an admitted VIDEO clone immediately before starting transport', async () => {
    let recordingStream: MediaStream | undefined;
    vi.stubGlobal('MediaRecorder', class extends Recorder { constructor(stream: MediaStream) { super(); recordingStream = stream; } });
    const f = environment(), camera = stream(true), callback = vi.fn();
    f.platform.createMetronomeAudio = vi.fn(() => {
      recordingStream!.getVideoTracks()[0].stop(); return metronomeAudioFixture();
    });
    const controller = f.create('MIDI', 4, 'VIDEO', callback, camera.media);
    await controller.start();
    expect(controller.snapshot()).toMatchObject({ session: 'FAILED_BEFORE_START', transport: null,
      evaluation: null, completed: null, analysisError: null, inputError: 'RECORDING_PREPARATION_FAILED' });
    expect(f.meter.start).not.toHaveBeenCalled(); expect(f.meter.dispose).toHaveBeenCalledOnce();
    expect(callback).not.toHaveBeenCalled();
    expect(recordingStream!.getTracks().every(track => track.readyState === 'ended')).toBe(true);
    expect(camera.media.getTracks().every(track => track.readyState === 'live')).toBe(true);
    await controller.dispose();
  });

  for (const outcome of ['FAILED', 'TIMEOUT'] as const) it(`MIDI completion degrades optional media when recorder freeze resolves ${outcome}`, async () => {
    class StopFaultRecorder extends Recorder {
      stop() {
        this.state = 'inactive';
        if (outcome === 'FAILED') throw new Error('stop failed');
        // Without a stop event, PerformanceRecorder settles through its bounded timeout.
      }
    }
    vi.stubGlobal('MediaRecorder', StopFaultRecorder);
    const f = environment();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => f.root.media) } });
    const recorder = new PerformanceRecorder('AUDIO');
    const freeze = vi.spyOn(recorder, 'freeze'), finalize = vi.spyOn(recorder, 'finalize');
    f.platform.createRecorder = () => recorder;
    const controller = f.create('MIDI', 0, 'AUDIO');
    try {
      await controller.start();
      expect(controller.snapshot().recording?.state).toBe('RECORDING');
      f.clock.set(1201); controller.refresh();
      const completion = controller.abandon();
      if (outcome === 'TIMEOUT') {
        await vi.advanceTimersByTimeAsync(1499);
        expect(controller.snapshot().session).toBe('FINALIZING');

        await vi.advanceTimersByTimeAsync(1);
      }
      await completion;

      expect(freeze).toHaveBeenCalledTimes(1);
      await expect(freeze.mock.results[0].value).resolves.toBe(outcome);
      expect(finalize).toHaveBeenCalledTimes(1);
      expect(controller.snapshot().session).toBe('COMPLETE');
      const completed = controller.snapshot().completed;
      expect(completed?.result.evaluation.status).toBe('COMPLETE');
      expect(completed?.recording).toEqual({ status: 'UNAVAILABLE', reason: outcome === 'FAILED' ? 'RECORDER_STOP_FAILED' : 'RECORDER_STOP_TIMEOUT' });
      expect(completed!.recording).toBeDefined();
    } finally {
      await controller.dispose(); freeze.mockRestore(); finalize.mockRestore();
    }
  });
  it('MIDI pause/resume preserves clock identity and abandonment discards the result', async () => {
    const f = environment(), controller = f.create('MIDI'); await controller.start();
    f.clock.set(100); controller.pause(); const T = controller.snapshot().transport!.performanceTimeMs;
    f.clock.set(600); controller.resume(); expect(controller.snapshot().transport!.performanceTimeMs).toBe(T);
    await controller.abandon(); expect(controller.snapshot().completed).toBeNull(); await controller.dispose();
  });
  it('bounds controller diagnostics across 100 transport cycles', async () => {
    const f = environment(), controller = f.create('MIDI'); await controller.start();
    for (let i = 0; i < 100; i++) { f.clock.advance(1); controller.pause(); f.clock.advance(1); controller.resume(); }
    expect(controller.engineeringSnapshot().diagnostics).toHaveLength(32);
    expect(Object.isFrozen(controller.engineeringSnapshot().diagnostics)).toBe(true);
    await controller.abandon(); await controller.dispose();
  });
  for (const rate of [44100, 48000]) it(`microphone count-in and natural terminal at ${rate}`, async () => {
    const f = environment(rate), callback = vi.fn(), controller = f.create('MICROPHONE', 1, 'OFF', callback); await controller.start();
    expect(controller.snapshot().transport?.state).toBe('COUNT_IN');
    expect(f.bridge().runtime.snapshot().counts.segmentsStarted).toBe(0);
    await f.feed(2100);
    expect(controller.snapshot().session).toBe('COMPLETE'); expect(controller.snapshot().completed?.result.evaluation.status).toBe('COMPLETE');
    const result = controller.snapshot().completed!.result;
    expect(result.evidenceProvenance).toMatchObject({ inputSource: 'MICROPHONE', sourceSampleRateHz: rate,
      sourceAdapterIdentitySha256: sourceIdentity(rate as 44100 | 48000).identitySha256, acousticCoreIdentitySha256: ACOUSTIC_MODEL.identitySha256 });
    if (result.evaluation.status !== 'COMPLETE') throw new Error('Expected complete evaluation');
    expect(result.evaluation.assignment.observations).toEqual([]);
    expect(f.platform.createAudioContext).toHaveBeenCalledTimes(1);
    expect(f.platform.createMetronomeAudio).toHaveBeenCalledWith(f.context);
    expect(f.context.close).toHaveBeenCalledTimes(1); expect(f.root.audio.stop).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ completionReason: 'SCOPE_COMPLETED' }));
    await controller.dispose();
  });
  it('cancels count-in BEGIN on pause, then replaces it on resume', async () => {
    const f = environment(), controller = f.create('MICROPHONE', 1); await controller.start();
    await f.feed(200); controller.pause(); await f.feed(700);
    expect(f.bridge().runtime.snapshot().counts.segmentsStarted).toBe(0);
    expect(controller.snapshot().transport?.state).toBe('PAUSED'); controller.resume(); await f.feed(controller.snapshot().transport!.countInRemainingMs); await f.feed(1800);
    expect(controller.snapshot().session).toBe('COMPLETE');
    expect(f.bridge().snapshot().boundaryDiagnostics.filter(d => d.action === 'CANCELLED').length).toBe(2); await controller.dispose();
  });
  it('preserves a logically reached BEGIN whose source message has not arrived at Pause', async () => {
    const f = environment(), controller = f.create('MICROPHONE', 1); await controller.start();
    await f.feed(480); f.context.currentTime += .030; controller.pause();
    expect(controller.snapshot().transport?.state).toBe('PAUSED'); await f.feed(200);
    expect(controller.snapshot().analysis).toBe('PAUSED'); expect(f.bridge().runtime.snapshot().counts.segmentsStarted).toBe(1);
    controller.resume(); await f.feed(controller.snapshot().transport!.countInRemainingMs); await f.feed(1600); await controller.abandon();
    expect(controller.snapshot().completed?.result.evaluation.status).toBe('COMPLETE'); await controller.dispose();
  });
  it('cancels stale natural terminal near its boundary and resumes to a new one', async () => {
    const f = environment(), controller = f.create(); await controller.start(); await f.feed(1100); controller.pause();
    const T = controller.snapshot().transport!.performanceTimeMs; await f.feed(500);
    expect(controller.snapshot().transport!.performanceTimeMs).toBe(T); expect(controller.snapshot().session).toBe('ACTIVE');
    controller.resume(); expect(controller.snapshot().transport!.performanceTimeMs).toBe(T); await f.feed(controller.snapshot().transport!.countInRemainingMs); await f.feed(500);
    expect(controller.snapshot().session).toBe('COMPLETE'); expect(f.bridge().runtime.snapshot().analyzedThroughPerformanceMs).toBe(1200); await controller.dispose();
  });
  it('multiple pauses keep exact identity; abandonment does not drain the tail', async () => {
    const f = environment(), controller = f.create(); await controller.start();
    for (let i = 0; i < 3; i++) {
      await f.feed(180); controller.pause(); const T = controller.snapshot().transport!.performanceTimeMs;
      await f.feed(100); controller.resume(); expect(controller.snapshot().transport!.performanceTimeMs).toBe(T);
    }
    const windows = f.bridge().runtime.snapshot().counts.windowsStarted;
    await controller.abandon(); await f.feed(300);
    expect(f.bridge().runtime.snapshot().counts.windowsStarted).toBe(windows);
    expect(controller.snapshot().completed).toBeNull(); await controller.dispose();
  });
  it('abandonment during count-in cancels boundaries and creates no completion', async () => {
    const f = environment(), controller = f.create('MICROPHONE', 1); await controller.start();
    const promise = controller.abandon(); await f.feed(50); await promise;
    expect(f.bridge().runtime.snapshot().counts.windowsStarted).toBe(0);
    expect(f.bridge().runtime.snapshot().analyzedThroughPerformanceMs).toBe(-Infinity);
    expect(controller.snapshot().completed).toBeNull();
    await controller.dispose();
  });
  for (const paused of [false, true]) it(`terminal analysis failure pauses exactly once and respects ${paused ? 'USER' : 'INTERVENTION'} origin`, async () => {
    const f = environment(), complete = vi.fn(), controller = f.create('MICROPHONE', 0, 'AUDIO', complete, undefined, 8);
    await controller.start(); await f.feed(2200);
    expect(controller.snapshot().evaluation?.targets.length).toBeGreaterThan(0);
    const releaseAnalysis = vi.spyOn(ContinuousMicrophoneInput.prototype, 'dispose');
    const recorder = vi.spyOn(PerformanceRecorder.prototype, 'pause');
    const canonicalPause = vi.spyOn(ContinuousPracticeSession.prototype, 'pause');
    if (paused) controller.pause();
    const boundary = vi.spyOn(ContinuousMicrophoneInput.prototype, 'boundary'); boundary.mockClear();
    const assertBoundary = vi.spyOn(ContinuousMicrophoneInput.prototype, 'assertBoundary'); assertBoundary.mockClear();
    const identity = controller.engineeringSnapshot().sessionId;
    const publication = vi.spyOn(ContinuousPracticeSession.prototype, 'publishAnalysis');
    f.failure(); const publicationCount = publication.mock.calls.length;
    expect(controller.snapshot()).toMatchObject({ session: 'ACTIVE', analysis: 'INTERRUPTED', evaluation: null,
      transport: { state: 'PAUSED' }, analysisIntervention: { pauseOrigin: paused ? 'USER' : 'INTERVENTION' } });
    expect(f.meter.pause).toHaveBeenCalledOnce(); expect(recorder).toHaveBeenCalledOnce(); expect(canonicalPause).toHaveBeenCalledOnce();
    expect(boundary).not.toHaveBeenCalled(); expect(assertBoundary).not.toHaveBeenCalled();
    const T = controller.snapshot().transport!.performanceTimeMs;
    await f.feed(500); expect(controller.snapshot().transport!.performanceTimeMs).toBe(T);
    expect(publication).toHaveBeenCalledTimes(publicationCount);
    await controller.continueWithoutAnalysis(); await controller.continueWithoutAnalysis();
    expect(controller.snapshot()).toMatchObject({ analysis: 'DISABLED', analysisIntervention: null, evaluation: null });
    expect(f.worker.dispose).toHaveBeenCalledOnce(); expect(f.context.close).not.toHaveBeenCalled();
    expect(f.root.audio.stop).not.toHaveBeenCalled(); expect(f.root.copies[0].audio.stop).toHaveBeenCalledOnce();
    expect(f.root.copies[1].audio.stop).not.toHaveBeenCalled(); expect(controller.engineeringSnapshot().sessionId).toBe(identity);
    expect(controller.snapshot().inputError).toBeNull();
    expect(controller.snapshot().session).toBe('ACTIVE');
    if (paused) { expect(controller.snapshot().transport!.state).toBe('PAUSED'); controller.resume(); }
    expect(controller.snapshot().transport).toMatchObject({ state: 'COUNT_IN', countInKind: 'RESUME' });
    await f.feed(controller.snapshot().transport!.countInRemainingMs + 5000); await controller.abandon();
    expect(controller.snapshot().session).toBe('COMPLETE');
    const completion = controller.snapshot().completed!;
    expect(completion.result).toMatchObject({ schemaVersion: 8, evaluation: { status: 'UNAVAILABLE', inputSource: 'MICROPHONE',
      assignmentPolicyId: CONTINUOUS_ASSIGNMENT_POLICY_ID, reason: 'CONTINUOUS_ANALYSIS_UNAVAILABLE' } });
    expect(completedContinuousTargetFeedback(completion.result.evaluation)).toEqual({ targets: [] });
    expect(completion.recording.status).toBe('READY'); expect(complete).toHaveBeenCalledOnce();
    expect(f.worker.dispose).toHaveBeenCalledOnce(); expect(releaseAnalysis).toHaveBeenCalledOnce(); await controller.dispose();
    expect(f.context.close).toHaveBeenCalledOnce(); boundary.mockRestore(); assertBoundary.mockRestore(); recorder.mockRestore(); canonicalPause.mockRestore(); publication.mockRestore(); releaseAnalysis.mockRestore();
  });
  for (const kind of ['INITIAL', 'RESUME'] as const) it(`analysis failure freezes ${kind} count-in without phantom recording segments`, async () => {
    const f = environment(), controller = f.create('MICROPHONE', kind === 'INITIAL' ? 4 : 0, 'AUDIO'); await controller.start();
    const pause = vi.spyOn(PerformanceRecorder.prototype, 'pause'), resume = vi.spyOn(PerformanceRecorder.prototype, 'resume');
    if (kind === 'RESUME') { await f.feed(100); controller.pause(); controller.resume(); pause.mockClear(); resume.mockClear(); }
    const before = controller.snapshot().transport!; expect(before.state).toBe('COUNT_IN'); f.failure();
    expect(controller.snapshot().transport).toMatchObject({ state: 'PAUSED', performanceTimeMs: before.performanceTimeMs });
    await f.feed(100); await controller.continueWithoutAnalysis();
    expect(controller.snapshot().transport).toMatchObject({ state: 'COUNT_IN', countInKind: 'RESUME', performanceTimeMs: before.performanceTimeMs });
    if (kind === 'INITIAL') {
      expect(pause).not.toHaveBeenCalled(); expect(resume).not.toHaveBeenCalled();
      await f.feed(controller.snapshot().transport!.countInRemainingMs + 100);
      expect(controller.snapshot().recording?.state).toBe('RECORDING'); expect(resume).not.toHaveBeenCalled();
    }
    await controller.abandon(); await controller.dispose(); pause.mockRestore(); resume.mockRestore();
  });
  for (const first of ['analysis', 'recording'] as const) it(`composes ${first}-first incidents without bypassing recording choice`, async () => {
    const f = environment(), controller = f.create('MICROPHONE', 0, 'AUDIO'); await controller.start(); await f.feed(100);
    const recording = () => { const clone = f.root.copies[1]; clone.audio.muted = true; clone.audio.dispatchEvent(new Event('mute')); };
    if (first === 'analysis') { f.failure(); recording(); } else { recording(); f.failure(); }
    expect(controller.snapshot().analysisIntervention).toMatchObject({ pauseOrigin: 'INTERVENTION' });
    expect(controller.snapshot().resourceIntervention).toMatchObject({ impact: 'RECORDING_ONLY', pauseOrigin: 'INTERVENTION' });
    expect(f.meter.pause).toHaveBeenCalledOnce(); controller.continueWithoutRecording();
    expect(controller.snapshot().resourceIntervention).not.toBeNull();
    await controller.continueWithoutAnalysis(); expect(controller.snapshot().transport!.state).toBe('PAUSED');
    expect(controller.snapshot().resourceIntervention).not.toBeNull(); controller.continueWithoutRecording();
    expect(controller.snapshot().transport!.state).toBe('COUNT_IN'); await controller.abandon(); await controller.dispose();
  });
  it('disabled analysis releases source health but preserves canonical AudioContext protection', async () => {
    const f = environment(), controller = f.create(); await controller.start(); await f.feed(100); f.failure();
    await controller.continueWithoutAnalysis(); f.root.audio.stop();
    expect(controller.snapshot().resourceIntervention).toBeNull(); expect(controller.snapshot().transport!.state).toBe('COUNT_IN');
    f.context.state = 'suspended'; f.context.dispatchEvent(new Event('statechange'));
    expect(controller.snapshot()).toMatchObject({ transport: { state: 'PAUSED' }, resourceIntervention: { reason: 'AUDIO_CONTEXT_INTERRUPTED' } });
    f.context.state = 'running'; f.context.dispatchEvent(new Event('statechange')); expect(controller.continueAfterRecovery()).toBe(true);
    await controller.abandon(); await controller.dispose();
  });
  it('natural FINALIZING tail failure completes unavailable without a learner intervention', async () => {
    const f = environment(), done = vi.fn(), controller = f.create('MICROPHONE', 0, 'AUDIO', done); await controller.start();
    f.context.currentTime += 1.3; controller.refresh(); expect(controller.snapshot().session).toBe('FINALIZING');
    f.failure(); expect(controller.snapshot().analysisIntervention).toBeNull(); await vi.advanceTimersByTimeAsync(20);
    await controller.abandon(); expect(controller.snapshot().session).toBe('COMPLETE');
    expect(controller.snapshot().completed?.result.evaluation.status).toBe('UNAVAILABLE');
    expect(controller.snapshot().completed?.recording.status).toBe('READY'); expect(done).toHaveBeenCalledOnce(); await controller.dispose();
  });
  it('End discards an interrupted attempt and stale worker callbacks cannot revive it', async () => {
    const f = environment(), done = vi.fn(), controller = f.create('MICROPHONE', 0, 'AUDIO', done); await controller.start(); f.failure();
    await controller.abandon(); await controller.continueWithoutAnalysis(); f.failure(); await f.feed(1500);
    expect(controller.snapshot()).toMatchObject({ session: 'ABANDONED', completed: null, analysisIntervention: null });
    expect(done).not.toHaveBeenCalled(); expect(f.worker.dispose).toHaveBeenCalledOnce(); expect(f.context.close).toHaveBeenCalledOnce(); await controller.dispose();
  });
  for (const reason of ['ACOUSTIC_BACKPRESSURE_LIMIT_EXCEEDED', 'ACOUSTIC_WORKER_CRASH', 'ANALYSIS_RUNTIME_FAILED']) {
    it(`terminal runtime ${reason} uses analysis intervention, not device failure`, async () => {
      const f = environment(), controller = f.create(); await controller.start();
      f.bridge().runtime.failAnalysis(new Error(reason));
      expect(controller.snapshot()).toMatchObject({ analysis: 'INTERRUPTED', inputError: null, evaluation: null,
        resourceIntervention: null, analysisIntervention: { pauseOrigin: 'INTERVENTION' }, transport: { state: 'PAUSED' } });
      await controller.continueWithoutAnalysis(); await controller.abandon(); await controller.dispose();
      expect(f.worker.dispose).toHaveBeenCalledOnce();
    });
  }
  for (const incident of ['analysis','recording'] as const) it(`page teardown during ${incident} intervention discards without completion or stale revival`,async()=>{
    const f=environment(),done=vi.fn();let staleFailure:((error:Error)=>void)|undefined;
    const attach=f.worker.onFailure!;f.worker.onFailure=listener=>{staleFailure=listener;return attach(listener);};
    const controller=f.create('MICROPHONE',0,'AUDIO',done);await controller.start();await f.feed(100);
    if(incident==='analysis')f.failure();else{const clone=f.root.copies[1];clone.audio.muted=true;clone.audio.dispatchEvent(new Event('mute'));}
    expect(controller.snapshot().session).toBe('ACTIVE');expect(controller.snapshot().transport?.state).toBe('PAUSED');
    expect(incident==='analysis'?controller.snapshot().analysisIntervention:controller.snapshot().resourceIntervention).not.toBeNull();
    await controller.dispose();staleFailure?.(new Error('AFTER_UNMOUNT'));await f.feed(1500);await controller.dispose();
    expect(controller.snapshot()).toMatchObject({session:'DISPOSED',completed:null,analysisIntervention:null,resourceIntervention:null});
    expect(done).not.toHaveBeenCalled();
    expect(f.worker.dispose).toHaveBeenCalledOnce();expect(f.context.close).toHaveBeenCalledOnce();expect(f.root.audio.stop).not.toHaveBeenCalled();
  });
  it('Restart releases the interrupted attempt once and starts a fresh identity, inference lease and recording', async () => {
    const old = environment(), controller = old.create('MICROPHONE', 0, 'AUDIO'); await controller.start(); await old.feed(100);
    const identity = controller.engineeringSnapshot().sessionId; old.failure(); await controller.dispose();
    const fresh = environment(), next = fresh.create('MICROPHONE', 0, 'AUDIO'); await next.start(); old.failure();
    expect(next.engineeringSnapshot().sessionId).not.toBe(identity); expect(next.snapshot()).toMatchObject({ session: 'ACTIVE', analysisIntervention: null });
    expect(old.worker.dispose).toHaveBeenCalledOnce(); expect(old.context.close).toHaveBeenCalledOnce();
    expect(fresh.platform.acquireInference).toHaveBeenCalledOnce(); expect(fresh.worker).not.toBe(old.worker);
    expect(fresh.worker.dispose).not.toHaveBeenCalled(); expect(next.snapshot().recording?.state).toBe('RECORDING');
    await next.abandon(); await next.dispose();
  });
  it('defers an in-transaction worker failure pause until the canonical clock transaction closes', async () => {
    const f = environment(), controller = f.create(); await controller.start(); await f.feed(100); controller.pause();
    const meterResume = f.meter.resume.mockImplementationOnce(() => f.failure());
    expect(() => controller.resume()).not.toThrow();
    expect(controller.snapshot()).toMatchObject({ transport: { state: 'PAUSED' }, analysis: 'INTERRUPTED' });
    await controller.continueWithoutAnalysis(); expect(controller.snapshot().transport?.state).toBe('COUNT_IN');
    await controller.abandon(); await controller.dispose(); meterResume.mockReset();
  });
  it('holds learner choice until asynchronous inference release settles and rejects stale Continue after End', async () => {
    const f = environment(); let release!: () => void;
    f.worker.dispose = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const controller = f.create(); await controller.start(); f.failure();
    const continueChoice = controller.continueWithoutAnalysis();
    expect(controller.snapshot()).toMatchObject({ analysis: 'INTERRUPTED', transport: { state: 'PAUSED' } });
    const ended = controller.abandon(); release(); await continueChoice; await ended;
    expect(controller.snapshot().session).toBe('ABANDONED'); expect(f.meter.resume).not.toHaveBeenCalled();
    expect(f.worker.dispose).toHaveBeenCalledOnce(); await controller.dispose();
  });
  it('recording ON normal completion shares one acquisition and exact pause mapping', async () => {
    const f = environment(), controller = f.create('MICROPHONE', 0, 'AUDIO'); await controller.start();
    await f.feed(500); controller.pause(); const T = controller.snapshot().transport!.performanceTimeMs;
    await f.feed(300); controller.resume(); await f.feed(controller.snapshot().transport!.countInRemainingMs); await f.feed(1000);
    const completed = controller.snapshot().completed!;
    expect(completed.recording.status).toBe('READY'); expect(completed.result.evaluation.status).toBe('COMPLETE');
    if (completed.recording.status !== 'READY') throw new Error('Expected ready recording');
    expect(completed.recording.timebase.activeSegments[0].perfEndMs).toBe(T);
    expect(completed.recording.timebase.activeSegments[1].perfStartMs).toBe(T);
    await controller.dispose();
  });
  it('does not expose COMPLETE or completed truth while Worker cleanup is still pending', async () => {
    const f = environment(); let release: () => void = () => {};
    f.worker.dispose = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const controller = f.create(); await controller.start(); await f.feed(400);
    await f.feed(1200);
    const completion = controller.abandon(); await f.feed(400);
    expect(controller.snapshot().session).toBe('FINALIZING'); expect(controller.snapshot().completed).toBeNull();
    expect(f.root.audio.stop).not.toHaveBeenCalled(); expect(f.context.close).not.toHaveBeenCalled();
    release(); await completion;
    expect(controller.snapshot().session).toBe('COMPLETE'); expect(f.root.audio.stop).not.toHaveBeenCalled();
    expect(f.context.close).toHaveBeenCalledTimes(1); await controller.dispose();
  });
  it('pre-start model failure never begins transport or acquires microphone', async () => {
    const f = environment(); f.platform.acquireInference = async () => { throw new Error('ASSET_FAILURE'); };
    const controller = f.create(); await controller.start(); expect(controller.snapshot().session).toBe('FAILED_BEFORE_START');
    expect(controller.snapshot().transport).toBeNull(); expect(f.platform.createAudioContext).not.toHaveBeenCalled(); await controller.dispose();
  });
  it('observes a Worker crash during attempt context binding before transport starts', async () => {
    const f = environment(); f.context.resume.mockImplementation(async () => { f.failure(); });
    const controller = f.create(); await controller.start();
    expect(controller.snapshot().session).toBe('FAILED_BEFORE_START'); expect(controller.snapshot().transport).toBeNull();
    expect(controller.snapshot().analysisIntervention).toBeNull();
    expect(f.root.audio.stop).not.toHaveBeenCalled(); await controller.dispose();
  });
  it('unsupported source rate fails before start and releases owned preparation resources', async () => {
    const f = environment(96000), controller = f.create(); await controller.start();
    expect(controller.snapshot().session).toBe('FAILED_BEFORE_START'); expect(controller.snapshot().transport).toBeNull();
    expect(controller.snapshot().analysis).toBe('FAILED'); expect(f.root.audio.stop).not.toHaveBeenCalled();
    expect(f.context.close).toHaveBeenCalledTimes(1); expect(f.worker.dispose).toHaveBeenCalledTimes(1); await controller.dispose();
  });
  it('disposal during inference admission releases the late lease without touching borrowed roots', async () => {
    const f = environment(); let release!: (port: AcousticInferencePort) => void;
    f.platform.acquireInference = () => new Promise(resolve => { release = resolve; });
    const controller = f.create(), starting = controller.start(), disposed = controller.dispose();
    release(f.worker); await starting; await disposed;
    expect(f.worker.dispose).toHaveBeenCalledOnce(); expect(f.root.audio.stop).not.toHaveBeenCalled();
    expect(f.platform.createAudioContext).not.toHaveBeenCalled();
  });
  for (const finalizing of [false, true]) it(`dispose during ${finalizing ? 'FINALIZING' : 'RUNNING'} cleans each resource once`, async () => {
    const f = environment(), controller = f.create(); await controller.start(); await f.feed(100);
    if (finalizing) { f.context.currentTime += 1.2; controller.refresh(); }
    await controller.dispose(); await controller.dispose();
    expect(f.worker.dispose).toHaveBeenCalledTimes(1); expect(f.context.close).toHaveBeenCalledTimes(1); expect(f.root.audio.stop).not.toHaveBeenCalled();
  });
  it('rejects cancellation of an applied boundary and keeps scheduler storage bounded', async () => {
    const f = environment(), controller = f.create(); await controller.start();
    const id = f.bridge().snapshot().boundaryDiagnostics.find(d => d.action === 'APPLIED')!.id;
    expect(() => f.bridge().cancel(id)).toThrow('CAPTURE_BOUNDARY_NOT_PENDING'); expect(controller.snapshot().resourceIntervention).toMatchObject({ impact: 'INPUT_REQUIRED', recoverability: 'RESTART_REQUIRED' });
    expect(controller.snapshot().completed).toBeNull(); await controller.abandon(); await controller.dispose(); await controller.dispose();
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
    await controller.abandon(); await controller.dispose();
  });
});

for (const source of ['MIDI', 'MICROPHONE'] as const) for (const mode of ['OFF', 'AUDIO', 'VIDEO'] as const)
for (const transport of ['COUNT_IN', 'RUNNING', 'PAUSED'] as const) {
  it(`${source} ${mode} abandonment during ${transport} discards ownership without any completion`, async () => {
    const f = environment(), camera = stream(true), callback = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => f.root.media) } });
    const recorder = new PerformanceRecorder(mode);
    const finalize = vi.spyOn(recorder, 'finalize');
    f.platform.createRecorder = () => recorder;
    const controller = f.create(source, transport === 'COUNT_IN' ? 1 : 0, mode, callback, camera.media);
    await controller.start();
    if (mode !== 'OFF') expect(controller.snapshot().recording?.state).toBe(transport === 'COUNT_IN' ? 'NOT_STARTED' : 'RECORDING');
    if (transport === 'PAUSED') controller.pause();
    const owned = Reflect.get(recorder, 'ownedStream') as MediaStream | null;
    const mediaRecorder = Reflect.get(recorder, 'recorder') as Recorder | null;
    const lateData = mediaRecorder?.ondataavailable;
    mediaRecorder?.requestData();
    const completedEvaluation = vi.spyOn(Reflect.get(controller, 'session'), 'completedEvaluation');
    await controller.abandon(); await controller.abandon();
    f.clock.set(10000); controller.refresh(); await f.feed(200);
    expect(controller.snapshot()).toMatchObject({ session: 'ABANDONED', transport: null,
      sessionSnapshot: null, evaluation: null, recording: null, completed: null });
    for (const track of owned?.getTracks() ?? []) expect(track.readyState).toBe('ended');
    expect(mediaRecorder?.state ?? 'inactive').toBe('inactive');
    lateData?.({ data: new Blob(['late chunk']) });
    expect(Reflect.get(recorder, 'chunks')).toEqual([]);
    expect(completedEvaluation).not.toHaveBeenCalled(); expect(finalize).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
    await expect(recorder.finalize()).rejects.toThrow('RECORDING_DISCARDED');
    expect(camera.audio.stop).not.toHaveBeenCalled(); // Borrowed page preview remains page-owned.
    await controller.dispose();
  });
}

it('End before the scope latch wins even when the clock has passed the terminal time', async () => {
  const f = environment(), callback = vi.fn(), controller = f.create('MIDI', 0, 'OFF', callback);
  await controller.start(); f.clock.set(1300);
  // No transport refresh has latched the terminal transition yet.
  await controller.abandon(); controller.refresh(); await vi.advanceTimersByTimeAsync(100);
  expect(controller.snapshot().completed).toBeNull(); expect(callback).not.toHaveBeenCalled();
  await controller.dispose();
});

it('the formally latched natural completion wins a later End and publishes exactly once', async () => {
  const f = environment(), callback = vi.fn(), controller = f.create('MIDI', 0, 'OFF', callback);
  await controller.start(); f.clock.set(1300);
  Reflect.get(controller, 'session').advanceToNow(); // Explicit domain latch, before application refresh.
  await controller.abandon(); await controller.abandon(); controller.refresh();
  expect(controller.snapshot().session).toBe('COMPLETE');
  expect(controller.snapshot().completed?.result).toBeDefined();
  expect(callback).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ completionReason: 'SCOPE_COMPLETED' }));
  await controller.dispose();
});

it('late acoustic inference after abandonment cannot publish completion or mutate the next owner', async () => {
  const f = environment(), callback = vi.fn(), controller = f.create('MICROPHONE', 0, 'OFF', callback);
  await controller.start();
  let resolve!: (value: Awaited<ReturnType<AcousticInferencePort['run']>>) => void;
  vi.mocked(f.worker.run).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await f.feed(1000); expect(resolve).toBeDefined();
  const abandoning = controller.abandon();
  expect(f.worker.dispose).toHaveBeenCalledOnce();
  resolve({ events: [], inferenceMs: 0, decodeMs: 0, actualSessionRunCount: 100 });
  await abandoning;
  const next = environment(), fresh = next.create('MIDI'); await fresh.start();
  await f.feed(1000);
  expect(callback).not.toHaveBeenCalled(); expect(controller.snapshot().completed).toBeNull();
  expect(fresh.snapshot()).toMatchObject({ session: 'ACTIVE', completed: null });
  await fresh.abandon(); await controller.dispose(); await fresh.dispose();
});

it.each(['MIDI', 'MICROPHONE'] as const)('VIDEO %s Start after abandonment creates fresh live recording ownership', async source => {
  const camera = stream(true), first = environment();
  const firstOwner = first.create(source, 0, 'VIDEO', vi.fn(), camera.media);
  await firstOwner.start();
  expect(firstOwner.snapshot().recording?.state).toBe('RECORDING');
  const oldId = Reflect.get(firstOwner, 'session').snapshotSession().localSessionId;
  const oldRecorder = Reflect.get(firstOwner, 'recorder') as PerformanceRecorder;
  const oldTracks = (Reflect.get(oldRecorder, 'ownedStream') as MediaStream).getTracks();
  await firstOwner.abandon();
  const next = environment(), fresh = next.create(source, 0, 'VIDEO', vi.fn(), camera.media);
  await fresh.start();
  expect(fresh.snapshot().recording?.state).toBe('RECORDING');
  expect(Reflect.get(fresh, 'session').snapshotSession().localSessionId).not.toBe(oldId);
  expect(Reflect.get(fresh, 'recorder')).not.toBe(oldRecorder);
  for (const track of oldTracks) expect(track.readyState).toBe('ended');
  for (const track of camera.media.getTracks()) expect(track.readyState).toBe('live');
  await fresh.abandon(); await firstOwner.dispose(); await fresh.dispose();
});

it('one qualified environment serves fresh attempts with unique clocks, ledgers, leases and recorders', async () => {
  const worker = { load: vi.fn(async () => ({})), beginSession: vi.fn(async (_token: string) => {}), endSession: vi.fn(async () => {}),
    run: vi.fn(async (_token: string, input: Parameters<AcousticInferencePort['run']>[0]) => ({ events: [], inferenceMs: 0, decodeMs: 0, actualSessionRunCount: input.window.jobIndex + 1 })),
    dispose: vi.fn(async () => {}), terminate: vi.fn(), onFailure: () => () => {} };
  const engine = new AcousticEngine(() => worker), platform = { modelUrl: vi.fn(async () => '/verified-model'),
    createEngine: vi.fn(() => engine), validateCapture: vi.fn(async () => {}) };
  const workspace = new PracticeEnvironment(platform), prepare = vi.spyOn(workspace, 'validateAcoustic');
  const sharedRoot = stream(), acquire = vi.fn(async () => sharedRoot.media);
  const devices = new PracticeResourceBinding(planPracticeResources({ mode: 'CONTINUOUS_PLAY', inputSource: 'MICROPHONE', recordingMode: 'AUDIO' }), { acquireStream: acquire, acquireMidi: vi.fn() });
  await devices.open();
  await workspace.validateAcoustic({ inputMicrophone: devices.borrowRoots()!.inputMicrophone!, signal: new AbortController().signal });
  const ids = new Set<string>(), sessions = new Set<unknown>(), recorders = new Set<unknown>(), leases = new Set<unknown>(), contexts = new Set<unknown>();
  for (const natural of [false, false, true, true]) {
    const f = environment(48000, sharedRoot); f.platform.acquireInference = async signal => { const lease = await workspace.acquireInference(signal); leases.add(lease); return lease; };
    const owner = f.create('MICROPHONE', 0, 'AUDIO'); await owner.start();
    ids.add(owner.engineeringSnapshot().sessionId!); sessions.add(Reflect.get(owner, 'session')); recorders.add(Reflect.get(owner, 'recorder')); contexts.add(f.context);
    const phases = owner.engineeringSnapshot().startup;
    for (const phase of ['acquireInferenceLease', 'audioContextResume', 'firLoad', 'captureConnect', 'acousticPreroll', 'recorderAdmission']) {
      expect(phases).toContainEqual(expect.objectContaining({ phase, outcome: 'SUCCEEDED', durationMs: expect.any(Number) }));
    }
    expect(owner.snapshot().evaluation?.targets).toEqual([]);
    expect(owner.snapshot().evaluation).not.toHaveProperty('assignment');
    if (natural) { await f.feed(1500); expect(owner.snapshot().completed?.result).toBeDefined(); }
    await owner.abandon(); await owner.dispose();
    expect(f.root.audio.stop).not.toHaveBeenCalled(); expect(f.context.close).toHaveBeenCalledOnce();
    expect(engine.snapshot().state).toBe('READY_IDLE');
  }
  for (const values of [ids, sessions, recorders, leases, contexts]) expect(values.size).toBe(4);
  expect(prepare).toHaveBeenCalledOnce(); expect(platform.validateCapture).toHaveBeenCalledOnce(); expect(platform.modelUrl).toHaveBeenCalledOnce();
  expect(acquire).toHaveBeenCalledOnce(); expect(sharedRoot.audio.stop).not.toHaveBeenCalled();
  expect(worker.beginSession).toHaveBeenCalledTimes(5); // One qualification smoke lease, four fresh attempts.
  expect(new Set(worker.beginSession.mock.calls.map(call => call[0])).size).toBe(5);
  devices.close(); expect(sharedRoot.audio.stop).toHaveBeenCalledOnce();
  expect(worker.load).toHaveBeenCalledOnce(); expect(platform.createEngine).toHaveBeenCalledOnce();
  await workspace.dispose(); expect(worker.dispose).toHaveBeenCalledOnce();
});

it('resume countdown freezes recording/evaluation, rejects countdown MIDI, and resumes one existing recorder at T', async () => {
  const f = environment(), owner = f.create('MIDI', 0, 'AUDIO'); await owner.start();
  f.clock.set(300); owner.refresh(); owner.pause();
  const paused = owner.snapshot(), ledger = paused.evaluation, recorder = Reflect.get(owner, 'recorder');
  expect(paused.recording?.elapsedMs).toBe(300); owner.resume();
  const resume = owner.snapshot().transport!;
  expect(resume).toMatchObject({ state: 'COUNT_IN', countInKind: 'RESUME', performanceTimeMs: 300 });
  f.clock.advance(resume.countInRemainingMs - 1); owner.refresh();
  f.midiOptions().onAttack!({ sessionTime: Reflect.get(owner, 'session').timebase.runtimeToSessionTime(f.clock.nowMs()), noteNumber: 60, confidence: 1 });
  expect(owner.snapshot().transport?.performanceTimeMs).toBe(300);
  expect(owner.snapshot().evaluation).toEqual(ledger); expect(owner.snapshot().recording).toMatchObject({ state: 'PAUSED', elapsedMs: 300, indicatorVisible: true });
  f.clock.advance(1); owner.refresh();
  expect(owner.snapshot().transport).toMatchObject({ state: 'RUNNING', performanceTimeMs: 300 });
  expect(Reflect.get(owner, 'recorder')).toBe(recorder); expect(owner.snapshot().recording?.state).toBe('RECORDING');
  f.midiOptions().onAttack!({ sessionTime: Reflect.get(owner, 'session').timebase.runtimeToSessionTime(f.clock.nowMs()), noteNumber: 60, confidence: 1 });
  f.clock.advance(901); owner.refresh(); await owner.abandon();
  const completion = owner.snapshot().completed!; expect(completion.result.evaluation.status).toBe('COMPLETE');
  if (completion.result.evaluation.status !== 'COMPLETE' || completion.recording.status !== 'READY') throw new Error('Expected complete result and recording');
  expect(completion.result.evaluation.assignment.observations).toHaveLength(1);
  expect(completion.recording.timebase.activeSegments.map(segment => [segment.perfStartMs, segment.perfEndMs])).toEqual([[0, 300], [300, 1200]]);
  await owner.dispose();
});

it('microphone resume-countdown PCM cannot advance evidence and repeated Pause cancels pending BEGIN without damaging input', async () => {
  const f = environment(), owner = f.create(); await owner.start(); await f.feed(200); owner.pause();
  const T = owner.snapshot().transport!.performanceTimeMs;
  owner.resume(); const resume = owner.snapshot().transport!; await f.feed(200); owner.pause();
  expect(owner.snapshot()).toMatchObject({ transport: { state: 'PAUSED', performanceTimeMs: T }, resourceIntervention: null, analysisError: null });
  await f.feed(100); owner.resume(); await f.feed(resume.countInTotalMs - 100);
  expect(owner.snapshot().transport).toMatchObject({ state: 'COUNT_IN', countInKind: 'RESUME', performanceTimeMs: T });
  expect(Reflect.get(owner, 'session').evaluationSnapshot.assignment.analyzedThroughPerformanceMs).toBeLessThanOrEqual(T);
  await f.feed(200); expect(owner.snapshot().transport!.performanceTimeMs).toBeGreaterThan(T);
  expect(owner.snapshot().resourceIntervention).toBeNull(); await owner.abandon(); await owner.dispose();
});

it('controller refresh and repeated live snapshots never request the full assignment ledger', async () => {
  const f = environment(), controller = f.create('MIDI');
  const full = vi.spyOn(ContinuousAssignmentFinalizer.prototype, 'snapshot').mockImplementation(() => { throw Error('FULL_ASSIGNMENT_READ'); });
  try {
    await controller.start(); f.clock.set(600); controller.refresh();
    for (let i = 0; i < 100; i++) {
      const feedback = controller.snapshot().evaluation!;
      expect(Object.keys(feedback).sort()).toEqual(['targets']);
      expect(feedback).not.toHaveProperty('assignment'); expect(feedback).not.toHaveProperty('extraObservations');
    }
    expect(full).not.toHaveBeenCalled();
  } finally { full.mockRestore(); await controller.abandon(); await controller.dispose(); }
});

// Resource characterization uses only public controller commands, real clock/source mapping,
// current caps and complete 2048-sample transport blocks (no controller/session state injection).
it('R01 admitted running microphone failure freezes retained performance while copied inputs await the worker', async () => {
  const f = environment(48000, stream(), 2048), callback = vi.fn(), controller = f.create('MICROPHONE', 4, 'OFF', callback, undefined, 20);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  vi.mocked(f.worker.run).mockImplementation(async ({ window }) => { await gate; return { events: [], inferenceMs: 0, decodeMs: 0, actualSessionRunCount: window.jobIndex + 1 }; });
  try {
    await controller.start();
    await expect(f.feed(5400)).rejects.toThrow('ACOUSTIC_BACKPRESSURE_LIMIT_EXCEEDED');
    expect(controller.snapshot()).toMatchObject({ session: 'ACTIVE', transport: { state: 'PAUSED' },
      analysisIntervention: { pauseOrigin: 'INTERVENTION' }, resourceIntervention: null, evaluation: null, completed: null });
    expect(f.bridge().runtime.snapshot()).toMatchObject({ outstanding: 4, counts: { windowsQueued: 4 } });
    expect(callback).not.toHaveBeenCalled(); expect(f.meter.pause).toHaveBeenCalledOnce(); expect(f.root.audio.stop).not.toHaveBeenCalled();
  } finally { release(); await controller.abandon(); await controller.dispose(); }
  expect(f.worker.dispose).toHaveBeenCalledOnce(); expect(callback).not.toHaveBeenCalled();
});

it('R02 schema-valid short resume count-ins plus full-block capture accept fifth source region before real tail exists', async () => {
  const f = environment(48000, stream(), 2048), callback = vi.fn();
  const controller = f.create('MICROPHONE', 4 / 128, 'OFF', callback, undefined, 20, 128);
  try {
    await controller.start(); await f.feed(2048 / 48); // Consume the score-derived initial one-bar count-in.
    expect(controller.snapshot().transport?.state).toBe('RUNNING');
    const origin = f.context.currentTime;
    for (let cycle = 0; cycle < 4; cycle++) {
      f.context.currentTime = origin + (1 + cycle * 16.625) / 1000; controller.refresh();
      expect(controller.snapshot().transport?.state).toBe('RUNNING');
      if (cycle === 3) {
        expect(f.bridge().snapshot().pendingBoundaryCount).toBeLessThan(8);
        await f.feed(2048 / 48); // Consume the first three short regions using a real full-sized transport block.
        expect(f.bridge().runtime.snapshot()).toMatchObject({ pendingRegions: 3, outstanding: 0 });
      }
      controller.pause(); expect(controller.snapshot().transport?.state).toBe('PAUSED'); controller.resume();
      expect(controller.snapshot().transport).toMatchObject({ state: 'COUNT_IN', countInKind: 'RESUME' });
      expect(controller.snapshot().transport!.countInRemainingMs).toBeCloseTo(15.625, 6);
    }
    f.context.currentTime += .016625; controller.refresh();
    await expect(f.feed(2048 / 48)).resolves.toBeUndefined();
    expect(f.bridge().runtime.snapshot()).toMatchObject({ outstanding: 0,
      counts: { regionsStarted: 5, regionsDrained: 0, windowsQueued: 0 }, pendingRegions: 5, state: 'RUNNING', failureCode: null });
    expect(f.bridge().snapshot().failed).toBe(false);
    expect(controller.snapshot()).toMatchObject({ session: 'ACTIVE', transport: { state: 'RUNNING' },
      analysisError: null, analysisIntervention: null, resourceIntervention: null, completed: null });
    expect(f.worker.run).not.toHaveBeenCalled(); expect(callback).not.toHaveBeenCalled();
    expect(f.root.audio.stop).not.toHaveBeenCalled();
  } finally { await controller.abandon(); await controller.dispose(); }
  expect(f.worker.dispose).toHaveBeenCalledOnce(); expect(callback).not.toHaveBeenCalled();
});

it('R03 valid ninth-boundary fuse freezes, then explicit End releases it before a fresh healthy attempt', async () => {
  const f = environment(48000, stream(), 2048), callback = vi.fn();
  const controller = f.create('MICROPHONE', 4 / 128, 'OFF', callback, undefined, 20, 128);
  try {
    await controller.start(); const source = f.bridge().snapshot().nextSourceSampleIndex;
    f.context.currentTime += .025625; controller.refresh(); // Canonical15.625ms initial bar +10ms RUNNING; no full PCM message consumed yet.
    let historical: ReturnType<ContinuousCaptureBridge['snapshot']>['boundaryDiagnostics'] = [];
    for (let cycle = 0; cycle < 4; cycle++) {
      expect(controller.snapshot().transport?.state).toBe('RUNNING'); controller.pause();
      expect(f.bridge().snapshot().pendingBoundaryCount).toBe((cycle + 1) * 2);
      const pending = f.bridge().snapshot();
      expect(pending.boundaryDiagnostics.filter(d => d.action === 'CANCELLED' && d.type === 'TERMINAL')).toHaveLength(cycle + 1);
      expect(pending.boundaryDiagnostics.filter(d => d.action === 'CANCELLED' && d.type === 'BEGIN')).toHaveLength(0);
      // Diagnostics describe the witness; isPending confirms the actual retained queue, not a diagnostic surrogate.
      const retained = pending.boundaryDiagnostics.filter(d => d.action === 'SCHEDULED' && f.bridge().isPending(d.id));
      expect(retained.slice(0, historical.length)).toEqual(historical);
      expect(retained.map(d => d.type)).toEqual(Array.from({ length: cycle + 1 }, () => ['BEGIN', 'PAUSE']).flat());
      expect(retained).toHaveLength(2 * (cycle + 1)); expect(pending.nextSourceSampleIndex).toBe(source);
      expect(pending.boundaryDiagnostics.some(d => d.action === 'APPLIED')).toBe(false);
      for (let pair = 0; pair <= cycle; pair++) {
        const begin = retained[pair * 2], pause = retained[pair * 2 + 1];
        expect(pause.sourceSampleIndex).toBeGreaterThan(begin.sourceSampleIndex);
        expect(pause.performanceTimeMs).toBeGreaterThan(begin.performanceTimeMs);
        if (pair) {
          expect(begin.sourceSampleIndex).toBeGreaterThan(retained[pair * 2 - 1].sourceSampleIndex);
          expect(begin.performanceTimeMs).toBe(retained[pair * 2 - 1].performanceTimeMs);
        }
      }
      historical = retained;
      if (cycle < 3) {
        controller.resume(); expect(f.bridge().snapshot().pendingBoundaryCount).toBe((cycle + 1) * 2 + 2);
        const resumed = f.bridge().snapshot().boundaryDiagnostics.filter(d => d.action === 'SCHEDULED' && f.bridge().isPending(d.id));
        expect(resumed.slice(0, historical.length)).toEqual(historical);
        expect(resumed.slice(historical.length).map(d => d.type)).toEqual(['BEGIN', 'TERMINAL']);
        expect(resumed.at(-2)?.performanceTimeMs).toBe(historical.at(-1)?.performanceTimeMs);
        expect(f.bridge().snapshot().nextSourceSampleIndex).toBe(source);
        f.context.currentTime += .025625; controller.refresh(); // One 15.625ms canonical count-in +10ms performance.
      }
    }
    expect(f.bridge().snapshot()).toMatchObject({ pendingBoundaryCount: 8, failed: false, nextSourceSampleIndex: source });
    expect(f.bridge().runtime.snapshot().counts.regionsStarted).toBe(0);
    const canonicalPause = vi.spyOn(ContinuousPracticeSession.prototype, 'pause');
    const recorderPause = vi.spyOn(PerformanceRecorder.prototype, 'pause');
    const metronomePauses = f.meter.pause.mock.calls.length;
    expect(() => controller.resume()).not.toThrow();
    expect(canonicalPause).toHaveBeenCalledOnce(); expect(recorderPause).toHaveBeenCalledOnce();
    expect(f.meter.pause).toHaveBeenCalledTimes(metronomePauses + 1);
    canonicalPause.mockRestore(); recorderPause.mockRestore();
    expect(f.bridge().snapshot()).toMatchObject({ pendingBoundaryCount: 0, failed: true, nextSourceSampleIndex: source });
    expect(controller.snapshot()).toMatchObject({ session: 'ACTIVE', transport: { state: 'PAUSED' },
      analysisIntervention: null, analysisError: null, resourceIntervention: { reason: 'CAPTURE_PIPELINE_INVALID',
        recoverability: 'RESTART_REQUIRED', state: 'WAITING_FOR_USER', impact: 'INPUT_REQUIRED', pauseOrigin: 'INTERVENTION' }, completed: null });
    expect(controller.engineeringSnapshot().diagnostics.filter(d => d.action === 'RESOURCE_INTERVENTION')).toHaveLength(1);
    expect(f.bridge().runtime.snapshot().failureCode).toBe('CAPTURE_BOUNDARY_LIMIT_EXCEEDED');
    expect(f.worker.run).not.toHaveBeenCalled(); expect(callback).not.toHaveBeenCalled();
    // Total PCM lag102.5ms, below32*2048/48000 payload seconds: transport failure is not a prerequisite.
    expect(f.context.currentTime - source / 48000).toBeLessThan(32 * 2048 / 48000);
    const position = controller.snapshot().transport!.performanceTimeMs;
    f.context.currentTime += .1; controller.refresh();
    expect(controller.snapshot().transport).toMatchObject({ state: 'PAUSED', performanceTimeMs: position });
    expect(controller.continueAfterRecovery()).toBe(false); controller.resume();
    expect(controller.snapshot().transport).toMatchObject({ state: 'PAUSED', performanceTimeMs: position });
    expect(f.bridge().runtime.snapshot().failureCode).toBe('CAPTURE_BOUNDARY_LIMIT_EXCEEDED');
    expect(f.worker.run).not.toHaveBeenCalled(); expect(callback).not.toHaveBeenCalled();
    const failedBridge = f.bridge(), oldSession = controller.engineeringSnapshot().sessionId;
    await controller.abandon();
    expect(controller.snapshot()).toMatchObject({ session: 'ABANDONED', completed: null, resourceIntervention: null });
    expect(controller.snapshot().session).toBe('ABANDONED');
    expect(f.worker.dispose).toHaveBeenCalledOnce(); expect(f.context.close).toHaveBeenCalledOnce();
    expect(f.meter.dispose).toHaveBeenCalledOnce(); expect(f.root.copies[0].audio.stop).toHaveBeenCalledOnce();
    expect(f.root.audio.readyState).toBe('live'); expect(f.root.audio.stop).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
    // Reuse the healthy borrowed device, not any attempt-owned graph/session/lease.
    const fresh = environment(48000, f.root, 2048), next = fresh.create('MICROPHONE', 4 / 128, 'OFF', callback, undefined, 20, 128);
    try {
      await next.start();
      expect(next.engineeringSnapshot().sessionId).not.toBe(oldSession);
      expect(fresh.bridge()).not.toBe(failedBridge); expect(fresh.worker).not.toBe(f.worker); expect(fresh.context).not.toBe(f.context);
      expect(next.snapshot()).toMatchObject({ session: 'ACTIVE', transport: { state: 'COUNT_IN' }, analysisError: null,
        inputError: null, resourceIntervention: null, analysisIntervention: null, completed: null });
      expect(fresh.bridge().snapshot()).toMatchObject({ failed: false, pendingBoundaryCount: 2 });
      expect(fresh.bridge().runtime.snapshot().failureCode).toBeNull();
      await fresh.feed(2048 / 48);
      expect(next.snapshot().transport?.state).toBe('RUNNING');
      expect(failedBridge.runtime.snapshot().failureCode).toBe('CAPTURE_BOUNDARY_LIMIT_EXCEEDED');
      expect(callback).not.toHaveBeenCalled();
    } finally { await next.abandon(); await next.dispose(); }
    expect(fresh.worker.dispose).toHaveBeenCalledOnce(); expect(f.root.audio.stop).not.toHaveBeenCalled();
  } finally { await controller.abandon(); await controller.dispose(); }
  expect(f.worker.dispose).toHaveBeenCalledOnce(); expect(f.root.audio.stop).not.toHaveBeenCalled();
});

it('synchronous AudioContext health during resume pauses once after clock release and preserves recovery ownership', async () => {
  const f = environment(), callback = vi.fn(), controller = f.create('MICROPHONE', 0, 'AUDIO', callback);
  await controller.start(); await f.feed(100); controller.pause();
  const identity = controller.engineeringSnapshot().sessionId, position = controller.snapshot().transport!.performanceTimeMs;
  const canonicalPause = vi.spyOn(ContinuousPracticeSession.prototype, 'pause'), recorderPause = vi.spyOn(PerformanceRecorder.prototype, 'pause');
  const metronomePauses = f.meter.pause.mock.calls.length;
  f.meter.resume.mockImplementationOnce(() => {
    f.context.state = 'suspended'; f.context.dispatchEvent(new Event('statechange'));
    // The callback latches facts without recursively mutating canonical transport.
    expect(canonicalPause).not.toHaveBeenCalled();
  });
  try {
    expect(() => controller.resume()).not.toThrow();
    expect(controller.snapshot()).toMatchObject({ session: 'ACTIVE', transport: { state: 'PAUSED', performanceTimeMs: position },
      analysisIntervention: null, completed: null, resourceIntervention: { reason: 'AUDIO_CONTEXT_INTERRUPTED',
        impact: 'INPUT_AND_RECORDING', recoverability: 'SAME_PIPELINE_RECOVERABLE', state: 'WAITING_FOR_USER', pauseOrigin: 'INTERVENTION' } });
    expect(controller.engineeringSnapshot().sessionId).toBe(identity);
    expect(controller.engineeringSnapshot().diagnostics.filter(d => d.action === 'RESOURCE_INTERVENTION')).toHaveLength(1);
    expect(canonicalPause).toHaveBeenCalledOnce(); expect(recorderPause).toHaveBeenCalledOnce();
    expect(f.meter.pause).toHaveBeenCalledTimes(metronomePauses + 1);
    f.context.currentTime += .1; controller.refresh();
    expect(controller.snapshot().transport!.performanceTimeMs).toBe(position);
    f.context.state = 'running'; f.context.dispatchEvent(new Event('statechange'));
    expect(controller.snapshot().resourceIntervention?.state).toBe('RECOVERED_WAITING_FOR_USER');
    expect(controller.continueAfterRecovery()).toBe(true);
    expect(controller.snapshot().transport).toMatchObject({ state: 'COUNT_IN', countInKind: 'RESUME', performanceTimeMs: position });
    expect(canonicalPause).toHaveBeenCalledOnce(); expect(callback).not.toHaveBeenCalled();
  } finally { await controller.abandon(); await controller.dispose(); canonicalPause.mockRestore(); recorderPause.mockRestore(); }
});

for (const incident of ['input', 'analysis'] as const) for (const first of ['input', 'recording'] as const) {
  it(`synchronous ${incident}+recording incidents (${first} first) drain one canonical pause after resume`, async () => {
    const f = environment(), callback = vi.fn(), controller = f.create('MICROPHONE', 0, 'AUDIO', callback);
    await controller.start(); await f.feed(100); controller.pause();
    const canonicalPause = vi.spyOn(ContinuousPracticeSession.prototype, 'pause'), recorderPause = vi.spyOn(PerformanceRecorder.prototype, 'pause');
    const metronomePauses = f.meter.pause.mock.calls.length;
    const input = () => { if (incident === 'analysis') f.failure();
      else { f.root.audio.muted = true; f.root.audio.dispatchEvent(new Event('mute')); f.health.set('inputMicrophone', 'INTERRUPTED'); } };
    const recording = () => { const clone = f.root.copies[1]; clone.audio.muted = true; clone.audio.dispatchEvent(new Event('mute')); };
    f.meter.resume.mockImplementationOnce(() => { if (first === 'input') { input(); recording(); } else { recording(); input(); }
      expect(canonicalPause).not.toHaveBeenCalled(); });
    try {
      expect(() => controller.resume()).not.toThrow();
      expect(controller.snapshot()).toMatchObject({ session: 'ACTIVE', transport: { state: 'PAUSED' }, completed: null,
        resourceIntervention: { impact: incident === 'input' ? 'INPUT_AND_RECORDING' : 'RECORDING_ONLY', pauseOrigin: 'INTERVENTION' } });
      expect(controller.snapshot().analysisIntervention).toEqual(incident === 'analysis' ? { pauseOrigin: 'INTERVENTION' } : null);
      expect(canonicalPause).toHaveBeenCalledOnce(); expect(recorderPause).toHaveBeenCalledOnce();
      expect(f.meter.pause).toHaveBeenCalledTimes(metronomePauses + 1);
      controller.continueWithoutRecording(); expect(controller.snapshot().transport?.state).toBe('PAUSED');
      if (incident === 'analysis') await controller.continueWithoutAnalysis();
      expect(controller.snapshot().transport?.state).toBe('PAUSED'); expect(callback).not.toHaveBeenCalled();
      await controller.abandon();
      f.context.state = 'closed'; f.context.dispatchEvent(new Event('statechange')); f.failure();
      expect(controller.snapshot()).toMatchObject({ session: 'ABANDONED', analysisIntervention: null, resourceIntervention: null, completed: null });
    } finally { await controller.dispose(); canonicalPause.mockRestore(); recorderPause.mockRestore(); }
  });
}

it('synchronous hard capture failure survives weaker clock health and recording facts in the same resume', async () => {
  const f = environment(), controller = f.create('MICROPHONE', 0, 'AUDIO');
  await controller.start(); await f.feed(100); controller.pause();
  const canonicalPause = vi.spyOn(ContinuousPracticeSession.prototype, 'pause'), recorderPause = vi.spyOn(PerformanceRecorder.prototype, 'pause');
  const metronomePauses = f.meter.pause.mock.calls.length;
  f.meter.resume.mockImplementationOnce(() => {
    f.bridge().abort(new Error('CAPTURE_PIPELINE_INVALID'));
    f.context.state = 'suspended'; f.context.dispatchEvent(new Event('statechange'));
    const clone = f.root.copies[1]; clone.audio.muted = true; clone.audio.dispatchEvent(new Event('mute'));
    f.context.state = 'running'; f.context.dispatchEvent(new Event('statechange'));
  });
  try {
    expect(() => controller.resume()).not.toThrow();
    expect(controller.snapshot()).toMatchObject({ session: 'ACTIVE', transport: { state: 'PAUSED' }, analysisIntervention: null,
      resourceIntervention: { reason: 'CAPTURE_PIPELINE_INVALID', recoverability: 'RESTART_REQUIRED', impact: 'INPUT_AND_RECORDING',
        state: 'WAITING_FOR_USER', pauseOrigin: 'INTERVENTION' }, completed: null });
    expect(f.bridge().snapshot()).toMatchObject({ failed: true, pendingBoundaryCount: 0 });
    expect(f.bridge().runtime.snapshot().failureCode).toBe('CAPTURE_PIPELINE_INVALID');
    expect(controller.engineeringSnapshot().diagnostics.filter(d => d.action === 'RESOURCE_INTERVENTION')).toHaveLength(1);
    expect(canonicalPause).toHaveBeenCalledOnce(); expect(recorderPause).toHaveBeenCalledOnce();
    expect(f.meter.pause).toHaveBeenCalledTimes(metronomePauses + 1); expect(controller.continueAfterRecovery()).toBe(false);
  } finally { await controller.abandon(); await controller.dispose(); canonicalPause.mockRestore(); recorderPause.mockRestore(); }
});

it('R14 silent INFER after tailReady settles natural FINALIZING with healthy recording and UNAVAILABLE evaluation', async () => {
  const f = environment(48000, stream(), 2048), callback = vi.fn(), controller = f.create('MICROPHONE', 4, 'AUDIO', callback);
  const { service, client } = workerRpcRig(), engine = new AcousticEngine(() => client);
  await engine.prepare('/model'); f.platform.acquireInference = signal => engine.acquire(signal); service.silent.add('INFER');
  try {
    await controller.start(); await f.feed(3500);
    expect(f.bridge().runtime.tailReady).toBe(true);
    expect(f.bridge().runtime.snapshot()).toMatchObject({ pendingRegions: 0, outstanding: 2 });
    expect(controller.snapshot()).toMatchObject({ session: 'FINALIZING', analysisError: null, completed: null });
    await vi.advanceTimersByTimeAsync(SILENCE / 2);
    expect(controller.snapshot()).toMatchObject({ session: 'FINALIZING', analysisError: null, completed: null });
    expect(callback).not.toHaveBeenCalled(); expect(service.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SILENCE); await controller.abandon(); // Joins the existing natural completion, never abandons its scope.
    expect(f.bridge().runtime.snapshot()).toMatchObject({ outstanding: 0, failureCode: 'WORKER_TIMEOUT' });
    expect(engine.snapshot().state).toBe('FAILED'); expect(service.terminate).toHaveBeenCalledOnce();
    expect(controller.snapshot()).toMatchObject({ session: 'COMPLETE', analysisIntervention: null, resourceIntervention: null });
    const completed = controller.snapshot().completed!;
    expect(completed.result).toMatchObject({ schemaVersion: 8, evaluation: { status: 'UNAVAILABLE', reason: 'CONTINUOUS_ANALYSIS_UNAVAILABLE' } });
    expect(completed.result.evidenceProvenance).toEqual(microphoneEvidenceProvenance(48000));
    expect(completedContinuousTargetFeedback(completed.result.evaluation)).toEqual({ targets: [] });
    expect(completed.recording.status).toBe('READY'); expect(callback).toHaveBeenCalledOnce();
    expect(controller.snapshot().transport?.completionReason).toBe('SCOPE_COMPLETED');
    await vi.advanceTimersByTimeAsync(SILENCE * 2); expect(callback).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  } finally { await controller.dispose(); await engine.dispose(); }
});

it('ACTIVE worker INFER silence is analysis failure with same-session degradation, not capture-device failure', async () => {
  const f = environment(48000, stream(), 2048), callback = vi.fn(), controller = f.create('MICROPHONE', 0, 'AUDIO', callback);
  const { service, client } = workerRpcRig(), engine = new AcousticEngine(() => client);
  await engine.prepare('/model'); f.platform.acquireInference = signal => engine.acquire(signal); service.silent.add('INFER');
  try {
    await controller.start(); await f.feed(900);
    expect(controller.snapshot()).toMatchObject({ session: 'ACTIVE', transport: { state: 'RUNNING' }, analysisIntervention: null });
    expect(f.bridge().runtime.snapshot().outstanding).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(SILENCE);
    expect(controller.snapshot()).toMatchObject({ session: 'ACTIVE', transport: { state: 'PAUSED' }, evaluation: null,
      analysisIntervention: { pauseOrigin: 'INTERVENTION' }, resourceIntervention: null, completed: null });
    expect(f.bridge().snapshot().failed).toBe(false); expect(f.bridge().runtime.snapshot().failureCode).toBe('WORKER_TIMEOUT');
    const identity = controller.engineeringSnapshot().sessionId, time = controller.snapshot().transport!.performanceTimeMs;
    f.context.currentTime += .1; controller.refresh(); expect(controller.snapshot().transport!.performanceTimeMs).toBe(time);
    await controller.continueWithoutAnalysis();
    expect(controller.snapshot()).toMatchObject({ session: 'ACTIVE', analysis: 'DISABLED', analysisIntervention: null,
      resourceIntervention: null, evaluation: null, transport: { state: 'COUNT_IN', countInKind: 'RESUME' } });
    expect(controller.engineeringSnapshot().sessionId).toBe(identity); expect(f.context.close).not.toHaveBeenCalled();
    expect(f.root.audio.stop).not.toHaveBeenCalled(); expect(service.terminate).toHaveBeenCalledOnce();
    expect(service.messages.filter(message => message.type === 'INFER')).toHaveLength(2); // Smoke plus the failed service request; no retry.
    expect(callback).not.toHaveBeenCalled();
  } finally { await controller.abandon(); await controller.dispose(); await engine.dispose(); }
});

for (const clockAdvanceMs of [0, 50]) it(`R18 event-driven preroll with observation clock advance=${clockAdvanceMs}ms preserves source/event geometry`, async () => {
  const f = environment(), publications: ContinuousEvidencePublication[] = [], failure = vi.fn(), releaseCapture = vi.fn();
  let stopped = false;
  const stop = vi.fn(() => { if (!stopped) { stopped = true; releaseCapture(); } });
  let bridge!: ContinuousCaptureBridge, attached!: () => void;
  const captureAttached = new Promise<void>(resolve => { attached = resolve; });
  f.platform.connectCapture = async options => { bridge = options.bridge; attached(); return { stop }; };
  vi.mocked(f.worker.run).mockImplementation(async ({ window }) => ({ events: [{ targetSample: Math.ceil(window.ownedStartTarget),
    midiPitch: 60, pitch: 'C4', confidence: .8, onsetScore: .8, frameScore: .8 }], inferenceMs: 0, decodeMs: 0, actualSessionRunCount: window.jobIndex + 1 }));
  const input = new ContinuousMicrophoneInput(f.platform, failure), abort = new AbortController();
  await input.acquire(abort.signal); f.clock.set(10000);
  const timer = vi.spyOn(globalThis, 'setTimeout');
  let next = 0, sequence = 0;
  const feed = (end: number) => { while (next < end) { const start = next; next = Math.min(end, start + 2048);
    bridge.receive({ type: 'pcm-chunk', sequence: sequence++, sourceSampleRateHz: 48000,
      sourceStartSampleIndex: start, sourceEndSampleIndex: next, audioContextStartFrame: start,
      captureTimeSeconds: start / 48000, inputChannelCount: 1, samples: new Float32Array(next - start) });
  } f.context.currentTime = next / 48000; };
  try {
    let connected = false;
    const connecting = input.connect({ context: f.context as unknown as AudioContext, stream: f.root.media,
      sessionDomainId: 'polling', clock: f.clock, publish: p => { publications.push(p); } }, abort.signal).then(() => { connected = true; });
    await captureAttached; await vi.advanceTimersByTimeAsync(0);
    expect(bridge.runtime.prerollReady).toBe(false); expect(timer.mock.calls.map(call => call[1])).toEqual([15000]);
    feed(88064); expect(bridge.runtime.prerollReady).toBe(true); expect(connected).toBe(false);
    await connecting; expect(connected).toBe(true);
    expect(timer.mock.calls.some(call => call[1] === 5)).toBe(false); expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(clockAdvanceMs); // No timer advances are needed to discover readiness.
    const origin = next;
    input.boundary('BEGIN', origin / 48000, 0); input.boundary('TERMINAL', origin / 48000 + .1, 100);
    feed(origin + 14336); await input.finish(abort.signal);
    const observations = publications.flatMap(p => p.observations);
    expect(observations).toHaveLength(1);
    const eventSample = Math.ceil(origin / 3) * 3;
    expect(observations[0].provenance?.sourceEventSample).toBe(eventSample);
    expect(observations[0].performanceTimeMs).toBeCloseTo((eventSample - origin) / 48, 9);
    expect(publications.every(p => p.availabilitySessionTimeMs === 10000)).toBe(true);
    expect(publications.at(-1)?.analyzedThroughPerformanceMs).toBe(100);
    expect(failure).not.toHaveBeenCalled();
  } finally { await input.dispose(); timer.mockRestore(); }
  expect(stop).toHaveBeenCalledTimes(2); expect(releaseCapture).toHaveBeenCalledOnce(); expect(f.worker.dispose).toHaveBeenCalledOnce();
  expect(f.context.close).not.toHaveBeenCalled(); expect(f.root.audio.stop).not.toHaveBeenCalled();
});
