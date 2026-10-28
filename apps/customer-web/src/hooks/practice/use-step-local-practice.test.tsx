import { borrowedDevices } from '@/lib/practice/__fixtures__/device-roots';
// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import artifactJson from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeInputSource, PracticeMode } from '@/lib/practice/kernel/session';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { ManualClock } from '@/lib/practice/kernel/timebase';
import { StepPracticeController } from '@/lib/practice/step/step-practice-controller';
import { ContinuousPracticeController } from '@/lib/practice/continuous/continuous-practice-controller';
import * as sessionIdentity from '@/lib/practice/kernel/session';
import * as stepPlatform from '@/lib/practice/step/step-platform';
import { useLocalPractice } from './use-local-practice';

afterEach(() => vi.restoreAllMocks());
const artifact = artifactJson as PracticeScoreArtifact;

function pendingMicrophone() {
  let releaseLease!: () => void;
  const stop = vi.fn(), track = { stop, readyState: 'live' }, stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const context = Object.assign(new EventTarget(), { state: 'running', sampleRate: 48000, currentTime: 0,
    close: vi.fn(async () => {}), resume: vi.fn(async () => {}) });
  const inference = { run: vi.fn(), dispose: vi.fn(async () => {}) };
  const nextInference = { run: vi.fn(), dispose: vi.fn(async () => {}) };
  const acquireInference = vi.fn().mockImplementationOnce(() => new Promise(resolve => { releaseLease = () => resolve(inference); }))
    .mockResolvedValue(nextInference);
  const connect = vi.fn(), midiStart = vi.fn(async () => {});
  const platform: stepPlatform.StepPlatform = { clock: new ManualClock(), timer: { schedule: vi.fn(), cancel: vi.fn() },
    createMidi: vi.fn(() => ({ start: midiStart, dispose: vi.fn(), getState: () => ({
      isSupported: true, isRunning: true, hasPermission: true, connectedInputCount: 1 }) })),
    createMetronome: () => ({ start: vi.fn(), destroy: vi.fn(), setEnabled: vi.fn(), setStepContext: vi.fn() }),
    microphone: {
      createAudioContext: () => context as unknown as AudioContext,
      acquireInference, coefficients: vi.fn(),
      connectCapture: connect, workletUrl: 'fake://not-started' } };
  const factory = vi.spyOn(stepPlatform, 'browserStepPlatform').mockReturnValue(platform);
  const options = (mode: PracticeMode = 'STEP_BY_STEP', inputSource: PracticeInputSource = 'MICROPHONE') =>
    ({ getDevices: () => borrowedDevices(stream as unknown as MediaStream), artifact, mode, inputSource, scope: { kind: 'FULL' as const } });
  return { platform, factory, options, inference, nextInference, acquireInference, stop, track, context, connect, midiStart, release: () => releaseLease() };
}

it('STEP Start is single-owner during preparation; unmount awaits late preparation without connecting capture', async () => {
  const r = pendingMicrophone(), disposal = vi.spyOn(StepPracticeController.prototype, 'dispose');
  const { result, unmount } = renderHook(() => useLocalPractice(r.options()));
  let starting!: Promise<void>;
  await act(async () => { starting = result.current.start(); });
  expect(result.current).toMatchObject({ mode: 'STEP_BY_STEP', lifecycle: 'PREPARING', inputState: 'STARTING', inputError: null });
  await act(async () => { await result.current.start(); });
  expect(r.factory).toHaveBeenCalledOnce(); expect(r.acquireInference).toHaveBeenCalledOnce();
  unmount(); expect(disposal).toHaveBeenCalledOnce();
  let released = false;
  const pending = disposal.mock.results[0].value.then(() => { released = true; });
  await Promise.resolve(); expect(released).toBe(false);
  await act(async () => { r.release(); await starting; await pending; });
  expect(r.connect).not.toHaveBeenCalled(); expect(r.inference.dispose).toHaveBeenCalledOnce();
  expect(r.stop).not.toHaveBeenCalled(); expect(r.context.close).not.toHaveBeenCalled();
  expect(r.platform.microphone!.createAudioContext).toBeTypeOf('function');
});

it.each(['input', 'mode'] as const)('%s switch waits for the old STEP microphone graph before another owner starts', async switchKind => {
  const r = pendingMicrophone();
  const continuousStart = vi.spyOn(ContinuousPracticeController.prototype, 'start').mockResolvedValue();
  const { result, rerender, unmount } = renderHook(({ mode, inputSource }) => useLocalPractice(r.options(mode, inputSource)),
    { initialProps: { mode: 'STEP_BY_STEP' as PracticeMode, inputSource: 'MICROPHONE' as PracticeInputSource } });
  let oldStart!: Promise<void>;
  await act(async () => { oldStart = result.current.start(); });
  rerender(switchKind === 'input' ? { mode: 'STEP_BY_STEP', inputSource: 'MIDI' } : { mode: 'CONTINUOUS_PLAY', inputSource: 'MICROPHONE' });
  let newStart!: Promise<void>;
  await act(async () => { newStart = result.current.start(); });
  expect(r.midiStart).not.toHaveBeenCalled(); expect(continuousStart).not.toHaveBeenCalled();
  await act(async () => { r.release(); await oldStart; await newStart; });
  expect(r.inference.dispose).toHaveBeenCalledOnce(); expect(r.connect).not.toHaveBeenCalled();
  expect(r.stop).not.toHaveBeenCalled(); expect(r.context.close).not.toHaveBeenCalled();
  expect(r.platform.microphone!.createAudioContext).toBeTypeOf('function');
  if (switchKind === 'input') { expect(r.midiStart).toHaveBeenCalledOnce(); expect(result.current.inputState).toBe('RUNNING'); }
  else expect(continuousStart).toHaveBeenCalledOnce();
  unmount();
});

it('restart waits for disposal, uses a fresh STEP identity and surfaces a fresh acquisition error without locking input', async () => {
  const r = pendingMicrophone(), starts = vi.spyOn(StepPracticeController.prototype, 'start');
  const identity = vi.spyOn(sessionIdentity, 'createLocalSessionId');
  const { result, unmount } = renderHook(() => useLocalPractice(r.options()));
  let first!: Promise<void>, restarting!: Promise<void>;
  await act(async () => { first = result.current.start(); });
  const firstId = identity.mock.results[0].value;
  r.track.readyState = 'ended';
  await act(async () => { restarting = result.current.restart(); });
  expect(starts).toHaveBeenCalledOnce();
  await act(async () => { r.release(); await first; await restarting; });
  expect(starts).toHaveBeenCalledTimes(2); expect(starts.mock.contexts[1]).not.toBe(starts.mock.contexts[0]);
  expect(identity.mock.results[1].value).not.toBe(firstId);
  expect(r.nextInference.dispose).toHaveBeenCalledOnce();
  expect(r.acquireInference.mock.invocationCallOrder[1]).toBeGreaterThan(r.inference.dispose.mock.invocationCallOrder[0]);
  expect(result.current).toMatchObject({ lifecycle: 'IDLE', inputState: 'ERROR', inputError: 'STEP_MICROPHONE_UNAVAILABLE' });
  expect(r.inference.dispose).toHaveBeenCalledOnce();
  unmount();
});

it('switching from pending Continuous startup waits for both disposal and late preparation before STEP starts', async () => {
  const r = pendingMicrophone(); let release!: () => void;
  vi.spyOn(ContinuousPracticeController.prototype, 'start').mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  const disposed = vi.spyOn(ContinuousPracticeController.prototype, 'dispose');
  const { result, rerender, unmount } = renderHook(({ mode }) => useLocalPractice(r.options(mode, 'MIDI')),
    { initialProps: { mode: 'CONTINUOUS_PLAY' as PracticeMode } });
  let oldStart!: Promise<void>, stepStart!: Promise<void>;
  await act(async () => { oldStart = result.current.start(); });
  rerender({ mode: 'STEP_BY_STEP' });
  await act(async () => { stepStart = result.current.start(); });
  expect(disposed).toHaveBeenCalledOnce(); expect(r.midiStart).not.toHaveBeenCalled();
  await act(async () => { release(); await oldStart; await stepStart; });
  expect(r.midiStart).toHaveBeenCalledOnce(); expect(result.current.lifecycle).toBe('ACTIVE');
  unmount();
});

it('STEP completion uses the latest callback after rerender without recreating its owner', async () => {
  const r = pendingMicrophone(), first = vi.fn(), latest = vi.fn();
  const starts = vi.spyOn(StepPracticeController.prototype, 'start');
  const { result, rerender, unmount } = renderHook(({ onNaturalCompletion }) =>
    useLocalPractice({ ...r.options('STEP_BY_STEP', 'MIDI'), onNaturalCompletion }),
    { initialProps: { onNaturalCompletion: first } });
  await act(async () => { await result.current.start(); });
  rerender({ onNaturalCompletion: latest });
  await act(async () => { if (result.current.mode !== 'STEP_BY_STEP') throw new Error('Expected STEP');
    for (const _ of artifact.expectedPracticeGroups) { void _; result.current.skip(); }
    await Promise.resolve(); });
  expect(first).not.toHaveBeenCalled(); expect(latest).toHaveBeenCalledOnce();
  expect(starts).toHaveBeenCalledOnce();
  unmount();
});

for (const kind of ['analysis', 'infrastructure'] as const) it.each(['End','unmount'] as const)(`STEP ${kind} intervention keeps target/input truth and the hook %s path retires ownership`,async ending=>{
  const {StepPracticeRuntime,groupForCurrentStep}=await import('@/lib/practice/step/domain/runtime');
  const runtime=new StepPracticeRuntime({artifact,scope:{kind:'FULL'},inputSource:'MICROPHONE',clock:new ManualClock(100),localSessionId:'hook-interrupted'});
  runtime.setInputUnavailable();
  const baseOwner=new StepPracticeController({devices:borrowedDevices(),artifact,scope:{kind:'FULL'},inputSource:'MICROPHONE'});
  let snapshot={...baseOwner.snapshot(),state:'ACTIVE' as 'ACTIVE'|'DISPOSED',analysisIntervention:kind==='analysis'?{kind:'TERMINAL_ANALYSIS_FAILURE' as const}:null,
    infrastructureIntervention:kind==='infrastructure'?{kind:'TERMINAL_INFRASTRUCTURE_FAILURE' as const}:null,
    sessionSnapshot:runtime.snapshot(),activeStepGroup:groupForCurrentStep(runtime)};
  const listeners=new Set<()=>void>();
  vi.spyOn(StepPracticeController.prototype,'subscribe').mockImplementation(listener=>{listeners.add(listener);return()=>listeners.delete(listener);});
  const snapshots=vi.spyOn(StepPracticeController.prototype,'snapshot').mockImplementation(()=>snapshot);
  const start=vi.spyOn(StepPracticeController.prototype,'start').mockImplementation(async()=>{listeners.forEach(f=>f());});
  let disposed=false;const domainEnd=vi.spyOn(runtime,'end');
  const dispose=vi.spyOn(StepPracticeController.prototype,'dispose').mockImplementation(async()=>{if(disposed)return;disposed=true;runtime.end();snapshot={...snapshot,state:'DISPOSED',analysisIntervention:null,infrastructureIntervention:null,sessionSnapshot:runtime.snapshot()};listeners.forEach(f=>f());});
  vi.spyOn(StepPracticeController.prototype,'abandon').mockImplementation(async function(this:StepPracticeController){await this.dispose();});
  const completion=vi.fn();const {result,unmount}=renderHook(()=>useLocalPractice({artifact,scope:{kind:'FULL'},mode:'STEP_BY_STEP',inputSource:'MICROPHONE',getDevices:()=>borrowedDevices(),onNaturalCompletion:completion}));
  await act(async()=>{await result.current.start();});
  const stale=[...listeners][0];expect(result.current).toMatchObject({lifecycle:'ACTIVE',runtimeStatus:'ACTIVE',inputState:'RUNNING',inputError:null,analysisIntervention:kind==='analysis'?{kind:'TERMINAL_ANALYSIS_FAILURE'}:null,infrastructureIntervention:kind==='infrastructure'?{kind:'TERMINAL_INFRASTRUCTURE_FAILURE'}:null,canAcceptAttempt:false});
  expect(result.current.activeStepGroup).not.toBeNull();expect(result.current).not.toHaveProperty('continueWithoutAnalysis');expect(result.current).not.toHaveProperty('controller');
  if(ending==='End'){await act(async()=>{await result.current.abandon();});expect(result.current.analysisIntervention).toBeNull();expect(result.current.mode==='STEP_BY_STEP'&&result.current.infrastructureIntervention).toBeNull();expect(result.current.lifecycle).toBe('IDLE');}
  unmount();await act(async()=>{await Promise.resolve();});const reads=snapshots.mock.calls.length;stale();expect(snapshots).toHaveBeenCalledTimes(reads);
  expect(dispose).toHaveBeenCalledTimes(ending==='End'?2:1);expect(domainEnd).toHaveBeenCalledOnce();expect(start).toHaveBeenCalledOnce();expect(runtime.state).toBe('ENDED');expect(completion).not.toHaveBeenCalled();
});
