import { metronomeAudioFixture, observeMetronomeRuntime } from '@/lib/practice/__fixtures__/metronome';
import { CaptureFailure } from '../failure/causal-failure';
import { rootHealthFixture } from '@/lib/practice/__fixtures__/root-health';
import { stepSessionPlan } from '@/lib/practice/__fixtures__/session-plan';
import { artifactWithKeys } from '@/lib/practice/__fixtures__/piano-key-artifact';
import { pianoMidiPitchToName } from '../acoustic/model/robust-piano-decoder';
import { borrowedDevices } from '../__fixtures__/device-roots';
import type { StepAttemptRecord } from './domain/attempt';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PracticeScope } from '@/lib/practice/kernel/scope';
import { ManualClock } from '@/lib/practice/kernel/timebase';
import { StepPracticeRuntime } from '@/lib/practice/step/domain/runtime';
import { SourceAnalysisRuntime, type SourceAnalysisOptions } from '../acoustic/runtime/source-analysis-runtime';
import type { SourceAcousticPublication } from '../acoustic/runtime/source-publication';
import type { CaptureConsumer } from '../acoustic/source/capture-types';
import type { AcousticInferenceInput } from '../acoustic/runtime/inference-types';
import { StepMicrophoneInput } from './step-microphone-input';
import { StepPracticeController } from './step-practice-controller';
import { browserStepPlatform, type StepPlatform } from './step-platform';
import { AcousticEngine } from '../acoustic/model/acoustic-engine';
import { workerRpcRig } from '../acoustic/model/__fixtures__/worker-rpc';
import { ACOUSTIC_WORKER_RPC_SILENCE_TIMEOUT_MS as SILENCE } from '../acoustic/model/worker-liveness-policy';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const createSource = SourceAnalysisRuntime.create.bind(SourceAnalysisRuntime);
const artifact = artifactWithKeys([[60], [60], [60]]);

/** Real STEP/source/assembler/chronology, deterministic PCM/inference ports. No model or device qualification. */
function rig(rate: 44100 | 48000 = 48000, selectedArtifact = artifact, scope: PracticeScope = { kind: 'FULL' }) {
  const origin = rate * 7;
  const health = rootHealthFixture();
  const track = Object.assign(new EventTarget(), { readyState: 'live', muted: false, stop: vi.fn() });
  const cloneStop = vi.fn();
  const stream = { getTracks: () => [track], getAudioTracks: () => [track], clone: vi.fn(() => ({ stop: cloneStop })) };
  const context = Object.assign(new EventTarget(), { sampleRate: Number(rate), currentTime: 7, state: 'running',
    resume: vi.fn(async () => {}), close: vi.fn(async () => { context.state = 'closed'; context.dispatchEvent(new Event('statechange')); }) });
  const metronome = observeMetronomeRuntime();
  let source!: SourceAnalysisRuntime, bridge!: CaptureConsumer, publish!: SourceAnalysisOptions['onPublication'];
  let next = 0, sequence = 0, paused = false, pianoKeys = [60], eventOffset = 8000;
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
      return { events: paused ? [] : pianoKeys.map(pianoKey => ({ pitch: pianoMidiPitchToName(pianoKey), midiPitch: pianoKey === 72 ? 72 : pianoKey === 62 ? 62 : 60,
        targetSample: Math.ceil(input.window.ownedStartTarget) + eventOffset, confidence: .8, onsetScore: .8, frameScore: .8 })),
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
    createMidi: vi.fn(), createMetronomeAudio: vi.fn(() => metronomeAudioFixture()),
    microphone: {
      createAudioContext: vi.fn(() => context as unknown as AudioContext),
      acquireInference: vi.fn(async () => worker), workletUrl: 'fake://worklet',
      coefficients: vi.fn(async r => readFile(`public/model-assets/practice-acoustic/${r === 44100 ? 'fir-160-441' : 'fir-1-3'}.f32`)),
      connectCapture: vi.fn(async options => {
        expect(options.stream).toBe(stream); expect(options.context).toBe(context);
        expect(options.ownership).toBe('BORROWED_SESSION_STREAM');
        stream.clone(); bridge = options.bridge; detach = bridge.attachCaptureCleanup(stopCapture);
        await feed(Math.ceil(rate * 2 / 2048)); return { stop: stopCapture };
      }),
    },
  };
  const completion = vi.fn();
  const controller = new StepPracticeController({ rootHealth: health.port, plan: stepSessionPlan(selectedArtifact, { scope: scope, inputSource: 'MICROPHONE' }), devices: borrowedDevices(stream as unknown as MediaStream), platform, onNaturalCompletion: completion });
  const finalized: StepAttemptRecord[] = [];
  controller.subscribe(() => {
    const record = controller.snapshot().pendingPostVerdict;
    if (record && finalized.at(-1)?.attemptId !== record.attemptId) finalized.push(record);
  });
  const startSpy = vi.spyOn(StepMicrophoneInput.prototype, 'start');
  const input = () => startSpy.mock.contexts.at(-1) as StepMicrophoneInput<unknown>;
  const untilFinalized = async (count: number) => {
    for (let i = 0; i < 100 && finalized.length < count; i++) await feed();
    expect(finalized).toHaveLength(count);
  };
  return { health, finalized, controller, platform, worker, stream, track, cloneStop, context, metronome, completion, feed, input, publications,
    starting: () => startSpy.mock.results.at(-1)!.value,
    untilFinalized, publish: (p: SourceAcousticPublication) => publish(p), source: () => source,
    captureFailure: (error = new CaptureFailure('PIPELINE_INVALID')) => bridge.abort(error),
    corruptCapture: () => bridge.receive({ type: 'pcm-chunk', sequence: sequence + 1, sourceSampleRateHz: rate,
      sourceStartSampleIndex: next, sourceEndSampleIndex: next + 2048, audioContextStartFrame: origin + next,
      captureTimeSeconds: (origin + next) / rate, inputChannelCount: 1, samples: new Float32Array(2048) }),
    pause: () => { paused = true; }, offset: (value: number) => { eventOffset = value; },
    resume: async () => { paused = false; for (const release of releases.splice(0)) release(); await source.drain(); }, pianoKeys: (p: number[]) => { pianoKeys = p; },
    staleFailure: () => workerFailure, workerFailure: () => workerFailure?.(new Error('WORKER_CRASH')), origin, rate };
}

describe.each([44100, 48000] as const)('STEP microphone controller / %i / deterministic ports', rate => {
  it.each(['READY', 'CAPTURING', 'ANALYZING'] as const)('temporary mute in %s cancels unfinished evidence, preserves progress and recovers after fresh physical retirement', async phase => {
    const r = rig(rate); await r.controller.start(); await r.untilFinalized(1);
    const prior = r.controller.snapshot().sessionSnapshot!;
    if (phase !== 'READY') {
      r.offset(9590);
      for (let i = 0; i < 100 && r.controller.snapshot().stepInteractionPhase !== 'CAPTURING'; i++) await r.feed();
      if (phase === 'ANALYZING') {
        const runtime = (r.controller as unknown as { runtime: StepPracticeRuntime }).runtime;
        runtime.analyzeAttempt(runtime.snapshot().step.activeAttempt!);
      }
      expect(r.controller.snapshot().stepInteractionPhase).toBe(phase);
    }
    r.pause(); await r.feed(20);
    r.track.muted = true; r.track.dispatchEvent(new Event('mute')); r.health.set('inputMicrophone', 'INTERRUPTED');
    expect(r.controller.snapshot()).toMatchObject({ state: 'ACTIVE', error: 'STEP_MICROPHONE_INTERRUPTED', canAcceptAttempt: false,
      sessionSnapshot: { localSessionId: prior.localSessionId, step: { currentIndex: 1, activeAttempt: null, inputAvailable: false } } });
    await r.feed(3);
    const watermark = r.input().snapshot().capture!.capturedThroughSourceSample;
    r.track.muted = false; r.track.dispatchEvent(new Event('unmute')); r.health.set('inputMicrophone', 'HEALTHY');
    expect(r.controller.snapshot()).toMatchObject({ state: 'ACTIVE', error: null, canAcceptAttempt: true,
      sessionSnapshot: { localSessionId: prior.localSessionId, step: { currentIndex: 1, inputEligibleAfter: { sampleIndex: watermark } } } });
    r.offset(8000); await r.resume();
    expect(r.finalized).toHaveLength(1); expect(r.completion).not.toHaveBeenCalled();
    await r.untilFinalized(2);
    expect(r.finalized[1].attemptStartSessionTime.sampleIndex).toBeGreaterThan(watermark);
    expect(r.controller.snapshot().sessionSnapshot!.step.currentIndex).toBe(2);
    expect(r.platform.microphone!.acquireInference).toHaveBeenCalledOnce();
    expect(r.platform.microphone!.createAudioContext).toHaveBeenCalledOnce();
    expect(r.controller.snapshot().analysisIntervention).toBeNull(); expect(r.controller.snapshot().infrastructureIntervention).toBeNull();
    await r.controller.dispose();
  });
  for (const phase of ['READY', 'CAPTURING', 'ANALYZING', 'POST_VERDICT'] as const) {
    for (const fault of ['root', 'context', 'capture'] as const) {
      it.each(['End', 'unmount'] as const)(`${phase} ${fault} infrastructure failure retains truth until %s`, async end => {
        const r = rig(rate); await r.controller.start(); await r.untilFinalized(1);
        const prior = r.controller.snapshot().sessionSnapshot!, staleFailure = r.staleFailure()!;
        const unavailable = vi.spyOn(StepPracticeRuntime.prototype, 'setInputUnavailable');
        const domainEnd = vi.spyOn(StepPracticeRuntime.prototype, 'end');
        let pending: StepAttemptRecord | null = null;
        const fail = () => {
          if (fault === 'root') { r.track.readyState = 'ended'; r.track.dispatchEvent(new Event('ended')); r.health.set('inputMicrophone', 'LOST'); }
          else if (fault === 'context') { r.context.state = 'closed'; r.context.dispatchEvent(new Event('statechange')); }
          else r.captureFailure();
        };
        if (phase === 'ANALYZING' || phase === 'POST_VERDICT') r.controller.subscribe(() => {
          if (r.controller.snapshot().stepInteractionPhase === phase && !r.controller.snapshot().infrastructureIntervention) {
            pending = r.controller.snapshot().pendingPostVerdict; fail();
          }
        });
        if (phase !== 'READY') {
          r.offset(9590);
          for (let i = 0; i < 100 && !r.controller.snapshot().infrastructureIntervention; i++) {
            try { await r.feed(); } catch (error) { if (!r.controller.snapshot().infrastructureIntervention) throw error; }
            if (phase === 'CAPTURING' && r.controller.snapshot().stepInteractionPhase === 'CAPTURING') break;
          }
        }
        if (phase === 'READY' || phase === 'CAPTURING') fail();
        const intervention = r.controller.snapshot().infrastructureIntervention;
        expect(intervention).toEqual({ kind: 'TERMINAL_INFRASTRUCTURE_FAILURE' });
        fail(); staleFailure(new Error('WORKER_CRASH')); r.captureFailure();
        await r.controller.start();
        expect(r.controller.snapshot()).toMatchObject({ state: 'ACTIVE', error: null, canAcceptAttempt: false,
          analysisIntervention: null, infrastructureIntervention: intervention,
          sessionSnapshot: { localSessionId: prior.localSessionId, runtimeStatus: 'ACTIVE', completionReason: null,
            sourceId: prior.sourceId, scope: prior.scope, tempoPlan: prior.tempoPlan, metronomeEnabled: prior.metronomeEnabled,
            step: { currentIndex: prior.step.currentIndex, targetGeneration: prior.step.targetGeneration,
              inputAvailable: false, activeAttempt: null } } });
        expect(r.controller.snapshot().activeStepGroup).toEqual(artifact.moments[prior.step.currentIndex]);
        expect(r.controller.snapshot().pendingPostVerdict).toEqual(pending);
        const retained = r.controller.snapshot().sessionSnapshot!.step;
        r.controller.skip(); r.publish(r.publications[0]);
        expect(r.controller.snapshot().sessionSnapshot!.step).toEqual(retained);
        expect(r.controller.snapshot().infrastructureIntervention).toBe(intervention);
        expect(unavailable).toHaveBeenCalledOnce(); expect(domainEnd).not.toHaveBeenCalled();
        expect(r.completion).not.toHaveBeenCalled();
        expect(r.worker.dispose).toHaveBeenCalledOnce(); expect(r.cloneStop).toHaveBeenCalledOnce();
        expect(r.context.close).toHaveBeenCalledTimes(fault === 'context' ? 0 : 1);
        expect(r.metronome.dispose).toHaveBeenCalledOnce(); expect(r.track.stop).not.toHaveBeenCalled();
        await (end === 'End' ? r.controller.abandon() : r.controller.dispose());
        expect(r.controller.snapshot()).toMatchObject({ state: 'DISPOSED', analysisIntervention: null, infrastructureIntervention: null,
          sessionSnapshot: { runtimeStatus: 'ENDED', completionReason: 'STOPPED_BY_USER' } });
        staleFailure(new Error('LATE_ANALYSIS_FAILURE')); fail(); await r.controller.dispose();
        expect(domainEnd).toHaveBeenCalledOnce(); expect(r.completion).not.toHaveBeenCalled();
        expect(r.worker.dispose).toHaveBeenCalledOnce(); expect(r.cloneStop).toHaveBeenCalledOnce();
        expect(r.context.close).toHaveBeenCalledTimes(fault === 'context' ? 0 : 1);
        expect(r.metronome.dispose).toHaveBeenCalledOnce(); expect(r.track.stop).not.toHaveBeenCalled();
        expect(r.platform.microphone!.acquireInference).toHaveBeenCalledOnce();
        expect(r.platform.microphone!.connectCapture).toHaveBeenCalledOnce();
      });
    }
  }
  for (const phase of ['READY','CAPTURING','ANALYZING','POST_VERDICT'] as const) for (const end of ['End','unmount'] as const) {
    it(`${phase} analysis failure retains real progress until ${end}, never a verdict or implicit end`,async()=>{
      const r=rig(rate);await r.controller.start();await r.untilFinalized(1);
      const prior=r.controller.snapshot().sessionSnapshot!, staleFailure=r.staleFailure()!;
      const unavailable=vi.spyOn(StepPracticeRuntime.prototype,'setInputUnavailable');
      const domainEnd=vi.spyOn(StepPracticeRuntime.prototype,'end');
      let pending: StepAttemptRecord | null=null;
      if(phase==='ANALYZING'||phase==='POST_VERDICT') r.controller.subscribe(()=>{
        if(r.controller.snapshot().stepInteractionPhase===phase&&!r.controller.snapshot().analysisIntervention){
          pending=r.controller.snapshot().pendingPostVerdict;staleFailure(new Error('WORKER_CRASH'));
        }
      });
      if(phase!=='READY'){
        r.offset(9590);
        for(let i=0;i<100&&!r.controller.snapshot().analysisIntervention;i++){
          try{await r.feed();}catch(error){if(!r.controller.snapshot().analysisIntervention)throw error;}
          if(phase==='CAPTURING'&&r.controller.snapshot().stepInteractionPhase==='CAPTURING')break;
        }
      }
      if(phase==='READY'||phase==='CAPTURING')staleFailure(new Error('WORKER_CRASH'));
      const intervention=r.controller.snapshot().analysisIntervention;
      expect(intervention).toEqual({kind:'TERMINAL_ANALYSIS_FAILURE'});staleFailure(new Error('REPEATED_FAILURE'));
      r.captureFailure(); r.track.readyState = 'ended'; r.track.dispatchEvent(new Event('ended')); r.health.set('inputMicrophone', 'LOST');
      expect(r.controller.snapshot().infrastructureIntervention).toBeNull();
      await r.controller.start(); // An existing owner cannot be auto-started or silently reacquired.
      expect(r.controller.snapshot().analysisIntervention).toBe(intervention);
      expect(r.controller.snapshot()).toMatchObject({state:'ACTIVE',error:null,canAcceptAttempt:false,
        sessionSnapshot:{runtimeStatus:'ACTIVE',completionReason:null,step:{currentIndex:prior.step.currentIndex,targetGeneration:prior.step.targetGeneration,inputAvailable:false,activeAttempt:null}}});
      expect(r.controller.snapshot().activeStepGroup).not.toBeNull();expect(unavailable).toHaveBeenCalledOnce();expect(domainEnd).not.toHaveBeenCalled();
      if(phase==='POST_VERDICT')expect(r.controller.snapshot().pendingPostVerdict).toEqual(pending);
      else expect(r.controller.snapshot().pendingPostVerdict).toBeNull();
      const frozen=r.controller.snapshot().sessionSnapshot!.step;
      r.controller.skip();r.publish(r.publications[0]);staleFailure(new Error('LATE_FAILURE'));
      expect(r.controller.snapshot().sessionSnapshot!.step).toEqual(frozen);
      expect(r.finalized).toHaveLength(phase==='POST_VERDICT'?2:1);expect(r.completion).not.toHaveBeenCalled();
      expect(r.worker.dispose).toHaveBeenCalledOnce();expect(r.cloneStop).toHaveBeenCalledOnce();expect(r.context.close).toHaveBeenCalledOnce();expect(r.metronome.dispose).toHaveBeenCalledOnce();expect(r.track.stop).not.toHaveBeenCalled();
      expect(r.platform.microphone!.acquireInference).toHaveBeenCalledOnce();
      await(end==='End'?r.controller.abandon():r.controller.dispose());
      expect(domainEnd).toHaveBeenCalledOnce();expect(r.controller.snapshot()).toMatchObject({state:'DISPOSED',analysisIntervention:null,sessionSnapshot:{runtimeStatus:'ENDED',completionReason:'STOPPED_BY_USER'}});
      staleFailure(new Error('AFTER_DISPOSAL'));r.publish(r.publications[0]);await r.controller.dispose();
      expect(r.controller.snapshot().analysisIntervention).toBeNull();expect(r.completion).not.toHaveBeenCalled();expect(r.worker.dispose).toHaveBeenCalledOnce();domainEnd.mockRestore();unavailable.mockRestore();
    });
  }
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
    expect(r.platform.createMetronomeAudio).toHaveBeenCalledWith(r.context);
    expect(r.platform.microphone!.connectCapture).toHaveBeenCalledOnce();
    await r.controller.abandon(); await r.controller.dispose(); await r.controller.dispose();
    expect(r.worker.dispose).toHaveBeenCalledOnce(); expect(r.cloneStop).toHaveBeenCalledOnce();
    expect(r.track.stop).not.toHaveBeenCalled(); expect(r.context.close).toHaveBeenCalledOnce(); expect(r.metronome.dispose).toHaveBeenCalledOnce();
    expect(r.completion).not.toHaveBeenCalled();
  });

  it.each([[60], [60, 72], [62]])('pianoKey evidence %j keeps target policy, exact H50 and synchronous physical rearm', async (...pianoKeys) => {
    const r = rig(rate); r.pianoKeys(pianoKeys);
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
    const verdict = pianoKeys.length === 1 && pianoKeys[0] === 60 ? 'MATCH' : 'MISMATCH';
    expect(record.verdict).toBe(verdict);
    expect(record.observedAttackKeys).toEqual([...pianoKeys].sort());
    expect(record.confidence).toBe(.8);
    expect(record.captureEndSessionTime.sampleIndex).toBe(record.attemptStartSessionTime.sampleIndex! + rate * 50 / 1000);
    expect(step).toMatchObject({ currentIndex: verdict === 'MATCH' ? 1 : 0, attemptState: 'READY', inputAvailable: true });
    expect(trace).toEqual(['rearm', 'arm']);
    expect(r.input().snapshot().analysis!.counts.regionsStarted).toBe(1);
    await r.controller.dispose();
  });

  it('skip retires physical capture while READY and cannot skip an active source-valid gesture', async () => {
    const r = rig(rate); await r.controller.start(); r.pause(); await r.feed(30);
    r.context.currentTime += .001; // the block frontier, not now(), owns retirement
    const boundary = r.input().snapshot().capture!.capturedThroughSourceSample;
    r.controller.skip();
    expect(r.controller.snapshot().sessionSnapshot!.step).toMatchObject({ currentIndex: 1, attemptState: 'READY', inputEligibleAfter: { sampleIndex: boundary } });
    await r.resume(); expect(r.finalized).toHaveLength(0);
    r.offset(9590);
    for (let i = 0; i < 100 && r.controller.snapshot().stepInteractionPhase !== 'CAPTURING'; i++) await r.feed();
    expect(r.controller.snapshot().stepInteractionPhase).toBe('CAPTURING');
    r.controller.skip(); expect(r.controller.snapshot().sessionSnapshot!.step.currentIndex).toBe(1);
    r.offset(8000); await r.untilFinalized(1);
    expect(r.finalized[0].attemptStartSessionTime.sampleIndex).toBeGreaterThan(boundary);
    expect(r.controller.snapshot().sessionSnapshot!.step.currentIndex).toBe(2);
    await r.controller.dispose();
  });

  it('newly owned observations before physical retirement are discarded despite fresh canonical identities', async () => {
    const r = rig(rate); await r.controller.start(); await r.untilFinalized(1);
    const retired = r.input().snapshot().retiredThroughSourceSample;
    r.offset(0);
    for (let i = 0; i < 100 && r.publications.length < 2; i++) await r.feed();
    expect(r.publications).toHaveLength(2);
    expect(r.publications[1].observations[0].sourceEventSample).toBeLessThan(retired);
    expect(r.finalized).toHaveLength(1); expect(r.controller.snapshot().canAcceptAttempt).toBe(true);
    r.offset(8000); await r.untilFinalized(2);
    expect(r.finalized[1].attemptStartSessionTime.sampleIndex).toBeGreaterThan(retired);
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
    r.offset(0); await r.resume();
    for (let i = 0; i < 100 && r.publications.length < 2; i++) await r.feed();
    expect(r.publications[1].observations[0].sourceEventSample).toBeLessThan(retired);
    expect(r.finalized).toHaveLength(1);
    expect(r.controller.snapshot().sessionSnapshot!.step).toMatchObject({ currentIndex: 1, activeAttempt: null, attemptState: 'READY' });
    r.offset(8000); await r.untilFinalized(2);
    expect(r.finalized[1].attemptStartSessionTime.sampleIndex).toBeGreaterThan(retired);
    expect(r.controller.snapshot().sessionSnapshot!.step.currentIndex).toBe(2);
    await r.controller.dispose();
  });

  it('final committed MATCH completes once without arming another acoustic target', async () => {
    const r = rig(rate); await r.controller.start();
    const runtime = (r.controller as unknown as { runtime: StepPracticeRuntime }).runtime;
    const arm = vi.spyOn(r.input(), 'arm');
    await r.untilFinalized(1);
    expect(arm).toHaveBeenCalledTimes(1); // Non-final MATCH still arms the next target.
    await r.untilFinalized(2);
    expect(arm).toHaveBeenCalledTimes(2);
    // This test driver must not drain an already disposed source after the terminal publication.
    await expect(r.untilFinalized(3)).rejects.toThrow('ACOUSTIC_RUNTIME_CLOSED');
    expect(runtime.isCompleted).toBe(true);
    expect(runtime.snapshot().completionReason).toBe('SCOPE_COMPLETED');
    expect(arm).toHaveBeenCalledTimes(2); // There is no fourth target to arm.
    await r.controller.abandon(); await r.controller.abandon();
    expect(r.controller.snapshot().lastSnapshot).toMatchObject({ runtimeStatus: 'ENDED', completionReason: 'SCOPE_COMPLETED',
      step: { currentIndex: 3, completed: true } });
    expect(r.finalized.map(a => a.verdict)).toEqual(['MATCH', 'MATCH', 'MATCH']);
    expect(r.controller.snapshot().analysisIntervention).toBeNull();
    expect(r.completion).toHaveBeenCalledOnce(); expect(r.worker.dispose).toHaveBeenCalledOnce();
    expect(r.cloneStop).toHaveBeenCalledOnce(); expect(r.track.stop).not.toHaveBeenCalled(); expect(r.context.close).toHaveBeenCalledOnce();
    expect(r.metronome.dispose).toHaveBeenCalledOnce();
    await r.controller.dispose(); expect(r.completion).toHaveBeenCalledOnce();
  });

  it('arm failure after domain rearm is terminal and never rolls back or reconnects', async () => {
    const r = rig(rate); await r.controller.start();
    const arm = vi.spyOn(r.input(), 'arm').mockImplementationOnce(() => { throw new Error('ARM_FAILED'); });
    await expect(r.untilFinalized(1)).rejects.toThrow('ACOUSTIC_RUNTIME_CLOSED'); await r.controller.abandon();
    expect(r.controller.snapshot()).toMatchObject({ state: 'DISPOSED', error: null, canAcceptAttempt: false });
    expect(r.controller.snapshot().sessionSnapshot!.step.currentIndex).toBe(1);
    expect(arm).toHaveBeenCalledOnce(); expect(r.platform.microphone!.connectCapture).toHaveBeenCalledOnce();
    await r.controller.dispose(); expect(r.worker.dispose).toHaveBeenCalledOnce();
  });

  it.each(['context', 'root', 'worker', 'analysis'] as const)('%s interruption is terminal, releases once and never reconnects', async kind => {
    const r = rig(rate); await r.controller.start();
    const finalizedBeforeFailure = [...r.finalized];
    if (kind === 'context') { r.context.state = 'suspended'; r.context.dispatchEvent(new Event('statechange')); }
    if (kind === 'root') { r.track.readyState = 'ended'; r.track.dispatchEvent(new Event('ended')); r.health.set('inputMicrophone', 'LOST'); }
    if (kind === 'worker') r.workerFailure();
    if (kind === 'analysis') r.source().failAnalysis(new Error('ANALYSIS_FAILURE'));
    expect(r.controller.snapshot()).toMatchObject({ state: 'ACTIVE', error: null, canAcceptAttempt: false });
    if (kind === 'worker' || kind === 'analysis') expect(r.controller.snapshot().analysisIntervention).toEqual({ kind: 'TERMINAL_ANALYSIS_FAILURE' });
    else expect(r.controller.snapshot().infrastructureIntervention).toEqual({ kind: 'TERMINAL_INFRASTRUCTURE_FAILURE' });
    expect(r.finalized).toEqual(finalizedBeforeFailure);
    await r.controller.abandon(); await r.controller.start(); await r.controller.dispose();
    expect(r.worker.dispose).toHaveBeenCalledOnce(); expect(r.cloneStop).toHaveBeenCalledOnce();
    expect(r.track.stop).not.toHaveBeenCalled(); expect(r.context.close).toHaveBeenCalledOnce(); expect(r.metronome.dispose).toHaveBeenCalledOnce();
    expect(r.platform.microphone!.connectCapture).toHaveBeenCalledOnce();
    r.track.dispatchEvent(new Event('ended')); r.health.set('inputMicrophone', 'LOST'); r.context.dispatchEvent(new Event('statechange'));
    expect(r.worker.dispose).toHaveBeenCalledOnce(); expect(r.completion).not.toHaveBeenCalled();
  });
});

it('failed lease acquisition opens no microphone, context or capture', async () => {
  const r = rig(); vi.mocked(r.platform.microphone!.acquireInference).mockRejectedValueOnce(new Error('ACOUSTIC_LEASE_FAILURE'));
  await r.controller.start(); await r.controller.dispose();
  expect(r.controller.snapshot().analysisIntervention).toBeNull();
  expect(r.controller.snapshot().error).toBe('STEP_ACOUSTIC_PREPARATION_FAILED');
  expect(r.platform.microphone!.connectCapture).not.toHaveBeenCalled();
  expect(r.worker.dispose).not.toHaveBeenCalled(); expect(r.platform.microphone!.createAudioContext).not.toHaveBeenCalled();
  expect(r.track.stop).not.toHaveBeenCalled(); expect(r.context.close).not.toHaveBeenCalled();
});

it('a lost borrowed root releases its inference lease before constructing a context or capture', async () => {
  const r = rig(); r.track.readyState = 'ended'; r.health.set('inputMicrophone', 'LOST');
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
  expect(r.track.stop).not.toHaveBeenCalled(); expect(r.context.close).toHaveBeenCalledOnce(); expect(r.metronome.dispose).toHaveBeenCalledOnce();
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
  const r = rig(rate); r.pianoKeys([]);
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

for (const phase of ['READY', 'CAPTURING', 'ANALYZING', 'POST_VERDICT'] as const) {
  it.each(['End', 'unmount'] as const)(`${phase} analysis cleanup rejection retains the active session until %s`, async end => {
    const r = rig(); await r.controller.start(); await r.untilFinalized(1);
    const prior = r.controller.snapshot().sessionSnapshot!;
    const domainEnd = vi.spyOn(StepPracticeRuntime.prototype, 'end');
    const staleFailure = r.staleFailure()!;
    let pending: StepAttemptRecord | null = null;
    r.worker.dispose.mockRejectedValueOnce(new Error('RELEASE_FAILED'));
    if (phase === 'ANALYZING' || phase === 'POST_VERDICT') r.controller.subscribe(() => {
      if (r.controller.snapshot().stepInteractionPhase === phase && !r.controller.snapshot().analysisIntervention) {
        pending = r.controller.snapshot().pendingPostVerdict;
        staleFailure(new Error('WORKER_CRASH'));
      }
    });
    if (phase !== 'READY') {
      r.offset(9590);
      for (let i = 0; i < 100 && !r.controller.snapshot().analysisIntervention; i++) {
        try { await r.feed(); } catch (error) { if (!r.controller.snapshot().analysisIntervention) throw error; }
        if (phase === 'CAPTURING' && r.controller.snapshot().stepInteractionPhase === 'CAPTURING') break;
      }
    }
    if (phase === 'READY' || phase === 'CAPTURING') staleFailure(new Error('WORKER_CRASH'));
    const intervention = r.controller.snapshot().analysisIntervention;
    await r.controller.start(); // Await the existing cleanup, without creating a new owner.
    expect(r.controller.snapshot()).toMatchObject({
      state: 'ACTIVE', error: 'STEP_RESOURCE_CLEANUP_FAILED', canAcceptAttempt: false,
      analysisIntervention: { kind: 'TERMINAL_ANALYSIS_FAILURE' },
      sessionSnapshot: { runtimeStatus: 'ACTIVE', completionReason: null, step: {
        currentIndex: prior.step.currentIndex, targetGeneration: prior.step.targetGeneration,
        inputAvailable: false, activeAttempt: null,
      } },
    });
    expect(r.controller.snapshot().activeStepGroup).toEqual(artifact.moments[prior.step.currentIndex]);
    expect(r.controller.snapshot().pendingPostVerdict).toEqual(pending);
    expect(domainEnd).not.toHaveBeenCalled(); expect(r.completion).not.toHaveBeenCalled();
    const retained = r.controller.snapshot().sessionSnapshot;
    staleFailure(new Error('REPEATED_FAILURE')); r.controller.skip(); r.publish(r.publications[0]);
    expect(r.controller.snapshot().analysisIntervention).toBe(intervention);
    expect(r.controller.snapshot().sessionSnapshot).toMatchObject({ ...retained, updatedAtMs: expect.any(Number) });
    expect(r.worker.dispose).toHaveBeenCalledOnce(); expect(r.cloneStop).toHaveBeenCalledOnce();
    expect(r.context.close).toHaveBeenCalledOnce(); expect(r.metronome.dispose).toHaveBeenCalledOnce();
    expect(r.track.stop).not.toHaveBeenCalled();

    await (end === 'End' ? r.controller.abandon() : r.controller.dispose());
    expect(r.controller.snapshot()).toMatchObject({
      state: 'DISPOSED', error: 'STEP_RESOURCE_CLEANUP_FAILED', analysisIntervention: null,
      sessionSnapshot: { runtimeStatus: 'ENDED', completionReason: 'STOPPED_BY_USER' },
    });
    expect(domainEnd).toHaveBeenCalledOnce();
    staleFailure(new Error('AFTER_TEARDOWN')); await r.controller.dispose();
    expect(domainEnd).toHaveBeenCalledOnce(); expect(r.completion).not.toHaveBeenCalled();
    expect(r.worker.dispose).toHaveBeenCalledOnce(); expect(r.cloneStop).toHaveBeenCalledOnce();
    expect(r.context.close).toHaveBeenCalledOnce(); expect(r.metronome.dispose).toHaveBeenCalledOnce();
    expect(r.track.stop).not.toHaveBeenCalled();
  });
}
it('natural completion wins late worker/capture failure and cannot open an intervention',async()=>{
  const r=rig();await r.controller.start();const stale=r.staleFailure()!;
  await expect(r.untilFinalized(3)).rejects.toThrow('ACOUSTIC_RUNTIME_CLOSED');await r.controller.abandon();stale(new Error('AFTER_COMPLETION'));r.publish(r.publications[0]);
  r.track.readyState = 'ended'; r.track.dispatchEvent(new Event('ended')); r.health.set('inputMicrophone', 'LOST');
  r.context.dispatchEvent(new Event('statechange')); r.captureFailure();
  expect(r.controller.snapshot()).toMatchObject({state:'ENDED',analysisIntervention:null,infrastructureIntervention:null,lastSnapshot:{completionReason:'SCOPE_COMPLETED'}});
  expect(r.completion).toHaveBeenCalledOnce();await r.controller.dispose();
});

it.each(['End', 'unmount'] as const)('infrastructure cleanup rejection retains POST_VERDICT until %s', async end => {
  const r = rig(); await r.controller.start(); await r.untilFinalized(1);
  const prior = r.controller.snapshot().sessionSnapshot!, stale = r.staleFailure()!;
  const domainEnd = vi.spyOn(StepPracticeRuntime.prototype, 'end');
  let pending: StepAttemptRecord | null = null;
  r.worker.dispose.mockRejectedValueOnce(new Error('RELEASE_FAILED'));
  r.controller.subscribe(() => {
    if (r.controller.snapshot().stepInteractionPhase === 'POST_VERDICT' && !r.controller.snapshot().infrastructureIntervention) {
      pending = r.controller.snapshot().pendingPostVerdict; r.captureFailure();
    }
  });
  await expect(r.untilFinalized(2)).rejects.toThrow('ACOUSTIC_PUBLICATION_SINK_FAILED');
  await r.controller.start();
  expect(r.controller.snapshot()).toMatchObject({ state: 'ACTIVE', error: 'STEP_RESOURCE_CLEANUP_FAILED',
    infrastructureIntervention: { kind: 'TERMINAL_INFRASTRUCTURE_FAILURE' }, analysisIntervention: null,
    canAcceptAttempt: false, sessionSnapshot: { runtimeStatus: 'ACTIVE', completionReason: null, step: {
      currentIndex: prior.step.currentIndex, targetGeneration: prior.step.targetGeneration, inputAvailable: false } } });
  expect(r.controller.snapshot().pendingPostVerdict).toEqual(pending);
  expect(domainEnd).not.toHaveBeenCalled(); expect(r.completion).not.toHaveBeenCalled();
  await (end === 'End' ? r.controller.abandon() : r.controller.dispose());
  expect(r.controller.snapshot()).toMatchObject({ infrastructureIntervention: null,
    sessionSnapshot: { runtimeStatus: 'ENDED', completionReason: 'STOPPED_BY_USER' } });
  stale(new Error('LATE_FAILURE')); await r.controller.dispose();
  expect(domainEnd).toHaveBeenCalledOnce(); expect(r.completion).not.toHaveBeenCalled();
  expect(r.worker.dispose).toHaveBeenCalledOnce(); expect(r.cloneStop).toHaveBeenCalledOnce();
  expect(r.context.close).toHaveBeenCalledOnce(); expect(r.metronome.dispose).toHaveBeenCalledOnce();
  expect(r.track.stop).not.toHaveBeenCalled();
});

it('invalid physical capture chronology latches infrastructure rather than analysis failure', async () => {
  const r = rig(); await r.controller.start();
  expect(r.corruptCapture).toThrow('CAPTURE_CHRONOLOGY_VIOLATION');
  expect(r.controller.snapshot()).toMatchObject({ state: 'ACTIVE', error: null, analysisIntervention: null,
    infrastructureIntervention: { kind: 'TERMINAL_INFRASTRUCTURE_FAILURE' },
    sessionSnapshot: { runtimeStatus: 'ACTIVE', completionReason: null, step: { inputAvailable: false } } });
  await r.controller.dispose(); expect(r.completion).not.toHaveBeenCalled();
});


it('explicit fresh owner after infrastructure End starts at configured scope with fresh session/context/inference', async () => {
  const first = rig(); await first.controller.start(); await first.untilFinalized(1);
  const prior = first.controller.snapshot().sessionSnapshot!;
  first.track.readyState = 'ended'; first.track.dispatchEvent(new Event('ended')); first.health.set('inputMicrophone', 'LOST');
  await first.controller.abandon();
  const fresh = rig(); await fresh.controller.start();
  expect(fresh.controller.snapshot()).toMatchObject({ state: 'ACTIVE', infrastructureIntervention: null,
    sessionSnapshot: { runtimeStatus: 'ACTIVE', completionReason: null, step: { currentIndex: 0, targetGeneration: 1 } } });
  expect(fresh.controller.snapshot().sessionSnapshot!.localSessionId).not.toBe(prior.localSessionId);
  expect(fresh.context).not.toBe(first.context); expect(fresh.worker).not.toBe(first.worker);
  expect(fresh.controller.snapshot().activeStepGroup).toEqual(artifact.moments[0]);
  await fresh.controller.dispose(); expect(first.completion).not.toHaveBeenCalled(); expect(fresh.completion).not.toHaveBeenCalled();
});

it('ACTIVE STEP worker INFER silence retains target under terminal analysis intervention, never infrastructure failure', async () => {
  vi.useFakeTimers(); const r = rig(), { service, client } = workerRpcRig(), engine = new AcousticEngine(() => client);
  try {
    await engine.prepare('/model'); r.platform.microphone!.acquireInference = vi.fn((signal: AbortSignal) => engine.acquire(signal));
    await r.controller.start(); const before = r.controller.snapshot().sessionSnapshot!;
    service.silent.add('INFER'); r.pause(); await r.feed(20);
    expect(r.source().snapshot().outstanding).toBeGreaterThan(0);
    expect(r.controller.snapshot()).toMatchObject({ state: 'ACTIVE', analysisIntervention: null, infrastructureIntervention: null });
    await vi.advanceTimersByTimeAsync(SILENCE - 1); expect(r.controller.snapshot().analysisIntervention).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(r.controller.snapshot()).toMatchObject({ state: 'ACTIVE', error: null, analysisIntervention: { kind: 'TERMINAL_ANALYSIS_FAILURE' },
      infrastructureIntervention: null, canAcceptAttempt: false, sessionSnapshot: { localSessionId: before.localSessionId,
        runtimeStatus: 'ACTIVE', completionReason: null, step: { currentIndex: before.step.currentIndex,
          targetGeneration: before.step.targetGeneration, inputAvailable: false, activeAttempt: null } } });
    expect(r.input().snapshot().failure).toBe('WORKER_TIMEOUT');
    expect(r.source().snapshot()).toMatchObject({ state: 'DISPOSED', outstanding: 0 }); expect(engine.snapshot().state).toBe('FAILED');
    expect(r.finalized).toHaveLength(0); expect(r.completion).not.toHaveBeenCalled();
    expect(r.cloneStop).toHaveBeenCalledOnce(); expect(r.context.close).toHaveBeenCalledOnce(); expect(r.metronome.dispose).toHaveBeenCalledOnce();
    expect(r.track.stop).not.toHaveBeenCalled(); expect(service.terminate).toHaveBeenCalledOnce();
    expect(r.platform.microphone!.acquireInference).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    await r.controller.abandon(); expect(r.controller.snapshot().sessionSnapshot?.completionReason).toBe('STOPPED_BY_USER');
    expect(r.completion).not.toHaveBeenCalled();
  } finally { await r.controller.dispose(); await engine.dispose(); vi.useRealTimers(); }
});

it('owns a physical-health subscription without observing borrowed track events and detaches on disposal', async () => {
  const r = rig(), listen = vi.spyOn(r.track, 'addEventListener');
  await r.controller.start(); const before = r.controller.snapshot().sessionSnapshot!;
  expect(listen).not.toHaveBeenCalled(); expect(r.health.listenerCount()).toBe(1);
  r.track.muted = true; r.track.dispatchEvent(new Event('mute'));
  expect(r.controller.snapshot().error).toBeNull();
  r.health.set('inputMicrophone', 'INTERRUPTED');
  expect(r.controller.snapshot()).toMatchObject({ error: 'STEP_MICROPHONE_INTERRUPTED', sessionSnapshot: { localSessionId: before.localSessionId } });
  await r.controller.dispose(); expect(r.health.listenerCount()).toBe(0);
  const retired = r.controller.snapshot(); r.health.set('inputMicrophone', 'HEALTHY');
  expect(r.controller.snapshot()).toEqual(retired);
});
