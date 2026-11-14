// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PracticeWorkspaceProvider, usePracticeWorkspace } from './practice-workspace-context';
import { createPracticePreparationKey } from '@/lib/practice/preparation/preparation-key';
import { PracticePreparationTransaction } from '@/lib/practice/preparation/preparation-transaction';
import { PracticeEnvironment } from '@/lib/practice/environment/practice-environment';
import { PracticeResourceBinding } from '@/lib/practice/device/practice-resource-binding';
import { planPracticeResources } from '@/lib/practice/planning/resource-plan';
import { midiDeviceFixture } from '@/lib/practice/__fixtures__/device-roots';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '@/lib/practice/score/artifact';
import { completedContinuousSessionFixture } from '@/lib/practice/__fixtures__/continuous-result';
import { recordingSinkFixture } from '@/lib/practice/__fixtures__/recording-sink';
import { continuousPracticePlan } from '@/lib/practice/__fixtures__/practice-plan';
import { createContinuousPerformanceResult } from '@/lib/practice/result/continuous-performance-result';
import { unavailableContinuousEvaluation } from '@/lib/practice/continuous/domain/evaluation/session';
import { PRACTICE_PREFERENCES_KEY } from '@/lib/practice/configuration/preference-storage';
afterEach(() => { localStorage.clear(); });
const profile = {
  schemaVersion: 1 as const,
  mode: 'STEP_BY_STEP' as const,
  inputSource: 'MIDI' as const,
  continuous: { recordingMode: 'OFF' as const, liveFeedbackEnabled: false },
};
async function rig(strict = false) {
  let current!: ReturnType<typeof usePracticeWorkspace>;
  function Capture() {
    current = usePracticeWorkspace();
    return null;
  }
  const environment = new PracticeEnvironment({
    modelUrl: vi.fn(),
    createEngine: vi.fn(),
    validateCapture: vi.fn(),
  });
  const tree = () => (
    <PracticeWorkspaceProvider createEnvironment={() => environment}>
      <Capture />
    </PracticeWorkspaceProvider>
  );
  const renderTree = () => strict ? <StrictMode>{tree()}</StrictMode> : tree();
  const view = render(renderTree());
  await waitFor(() => expect(current.hydrated).toBe(true));
  act(() => current.updateProfile(profile));
  const prepare = async () => {
    let transaction!: PracticePreparationTransaction;
    act(() => {
      transaction = current.beginPreparation(createPracticePreparationKey("score-1", "revision-1", current.configuration!));
    });
    const track = Object.assign(new EventTarget(), {
      kind: 'audio',
      readyState: 'live',
      muted: false,
      stop: vi.fn(),
    });
    const microphone = {
      getTracks: () => [track],
      getAudioTracks: () => [track],
      getVideoTracks: () => [],
    } as unknown as MediaStream;
    const midi = midiDeviceFixture(),
      binding = new PracticeResourceBinding(
        planPracticeResources(current.configuration!),
        {
          acquireMidi: async () => midi.access,
          acquireStream: vi.fn(async () => microphone),
        },
      );
    await binding.open();
    const bundle = Object.freeze({
      binding: { scoreId: 'score-1', revisionId: 'revision-1', bundleId: 'source-fixture' },
      artifact: { ...(fixture as PracticeScoreArtifact) }, musicXml: '<score />',
    });
    return { transaction, value: Object.freeze({ key: transaction.key, bundle, binding }), midi };
  };
  return {
    get current() {
      return current;
    },
    view,
    tree: renderTree,
    prepare,
    environment,
  };
}

it('commits key, Bundle evidence and binding; preferences persist without prepared readiness', async () => {
  const r = await rig(), p = await r.prepare();
  act(() => { expect(r.current.commitPreparedPractice(p.value, p.transaction)).toBe(true); });
  expect(r.current.preparedFor(createPracticePreparationKey('score-1','revision-1',{ ...r.current.configuration! }))).toBe(p.value);
  expect(p.value.binding.borrowRoots()!.midi).toBe(p.midi.access);
  expect(Object.keys(JSON.parse(localStorage.getItem(PRACTICE_PREFERENCES_KEY)!)).sort()).toEqual(['continuous','inputSource','mode','schemaVersion']);
  r.view.unmount();
  await waitFor(() => expect(p.value.binding.snapshot().state).toBe('CLOSED'));
  const next = await rig();
  expect(next.current.preparedPractice).toBeNull();
});
it('fresh equal configuration and candidate scope/tempo/metronome/feedback retain the exact preparation', async () => {
  const r = await rig(), p = await r.prepare();
  act(() => { r.current.commitPreparedPractice(p.value,p.transaction); });
  act(() => {
    r.current.enterPractice(createPracticePreparationKey('score-1','revision-1',{...r.current.configuration!}));
    r.current.setScope({kind:'FULL'}); r.current.setTempoSelection({mode:'CUSTOM_FIXED_BPM',bpm:90});
    r.current.setMetronomeEnabled(true);
    r.current.updateProfile({...profile,continuous:{...profile.continuous,liveFeedbackEnabled:true}});
  });
  r.view.rerender(r.tree());
  expect(r.current.preparedPractice).toBe(p.value);
  expect(p.value.binding.borrowRoots()!.midi).toBe(p.midi.access);
});
it('accepts semantically equal fresh resource plans', async () => {
  const r = await rig(), p = await r.prepare();
  const binding = new PracticeResourceBinding(structuredClone(p.value.binding.resourcePlan),{acquireMidi:async()=>p.midi.access,acquireStream:vi.fn()});
  await binding.open();
  expect(binding.resourcePlan).not.toBe(p.value.binding.resourcePlan);
  act(() => { expect(r.current.commitPreparedPractice({...p.value,binding},p.transaction)).toBe(true); });
  p.value.binding.close();
  expect(r.current.preparedPractice?.binding).toBe(binding);
});
it('enterSetup releases one binding and is idle; the next explicit command owns fresh admission', async () => {
  const r = await rig(), p = await r.prepare(), close=vi.spyOn(p.value.binding,'close');
  act(() => {r.current.commitPreparedPractice(p.value,p.transaction);r.current.enterPractice(p.value.key);});
  act(() => {r.current.enterSetup(p.value.key);r.current.enterSetup(p.value.key);});
  expect(close).toHaveBeenCalledOnce(); expect(r.current.preparedPractice).toBeNull();
  expect(r.environment.acousticState()).toBe('EMPTY');
});
it.each(['mode','inputSource','recordingMode','scoreId','revisionId'] as const)('%s replacement retires the keyed owner immediately', async field => {
  const r=await rig();
  act(()=>r.current.updateProfile({...profile,mode:'CONTINUOUS_PLAY'}));
  const p=await r.prepare();act(()=>{r.current.commitPreparedPractice(p.value,p.transaction);});
  act(()=>{
    if(field==='mode')r.current.updateProfile({...r.current.profile,mode:'STEP_BY_STEP'});
    else if(field==='inputSource')r.current.updateProfile({...r.current.profile,inputSource:'MICROPHONE'});
    else if(field==='recordingMode')r.current.updateProfile({...r.current.profile,continuous:{...r.current.profile.continuous,recordingMode:'AUDIO'}});
    else r.current.enterPractice(createPracticePreparationKey(field==='scoreId'?'other-score':'score-1',field==='revisionId'?'other-revision':'revision-1',r.current.configuration!));
  });
  expect(r.current.preparedPractice).toBeNull();expect(p.value.binding.snapshot().state).toBe('CLOSED');
});
it('superseding fences late A after B committed, without mutating B', async () => {
  const r=await rig(), a=await r.prepare(), b=await r.prepare();
  expect(a.transaction.signal.aborted).toBe(true);
  act(()=>{
    expect(r.current.commitPreparedPractice(b.value,b.transaction)).toBe(true);
    expect(r.current.commitPreparedPractice(a.value,a.transaction)).toBe(false);
    r.current.cancelPreparation(a.transaction);
  });
  expect(a.value.binding.snapshot().state).toBe('CLOSED');expect(r.current.preparedPractice).toBe(b.value);
  expect(b.value.binding.borrowRoots()).not.toBeNull();
});
it.each(['transaction','key','bundle-score','bundle-revision','plan','binding'] as const)('rejects inconsistent %s admission before granting handoff',async reason=>{
  const r=await rig(),p=await r.prepare();let value=p.value,transaction=p.transaction;
  if(reason==='transaction')transaction=new PracticePreparationTransaction(p.transaction.generation,p.value.key);
  if(reason==='key')value={...value,key:createPracticePreparationKey('other','revision-1',r.current.configuration!)};
  if(reason==='bundle-score'||reason==='bundle-revision')value={...value,bundle:{...value.bundle,binding:{...value.bundle.binding,...(reason==='bundle-score'?{scoreId:'other'}:{revisionId:'other'})}}};
  if(reason==='plan') value={...value,binding:new PracticeResourceBinding(planPracticeResources({mode:'STEP_BY_STEP',inputSource:'MICROPHONE',recordingMode:'OFF'}))};
  if(reason==='binding')value.binding.close();
  act(()=>{expect(r.current.commitPreparedPractice(value,transaction)).toBe(false);});
  expect(value.binding.borrowRoots()).toBeNull();expect(r.current.preparedPractice).toBeNull();p.value.binding.close();
});
it('Review handoff requires exact prepared key and executed Bundle; explicit Review visits retain media through immediate remount',async()=>{
  const r=await rig(true);act(()=>r.current.updateProfile({...profile,mode:'CONTINUOUS_PLAY'}));
  const p=await r.prepare();act(()=>{r.current.commitPreparedPractice(p.value,p.transaction);});
  const capture=recordingSinkFixture();await capture.sink.append(new Blob(['capture']));
  const media=await capture.sink.seal('audio/webm');
  const recording={status:'READY' as const,kind:'AUDIO' as const,media,mimeType:'audio/webm',timebase:{nominalMediaDurationUs:10000000,activeSegments:[{performanceStartUs:0,performanceEndUs:10000000,mediaStartUs:0,mediaEndUs:10000000}]}};
  const result=reviewResult(p.value.bundle);
  expect(()=>r.current.handoffToReview({result,recording},createPracticePreparationKey('other','revision-1',r.current.configuration!))).toThrow();
  expect(()=>r.current.handoffToReview({result:{...result,executed:{...result.executed,bundle:{...result.executed.bundle,artifact:{...result.executed.bundle.artifact}}}},recording},p.value.key)).toThrow();
  expect(r.current.preparedPractice).toBe(p.value);
  act(()=>{r.current.handoffToReview({result,recording},p.value.key);});
  const session=r.current.reviewSession;
  expect(session?.result.executed.bundle.artifact).toBe(p.value.bundle.artifact);
  expect(p.value.binding.snapshot().state).toBe('CLOSED');
  await media.release();expect(capture.exists()).toBe(true);
  let exit!:()=>void;
  act(()=>{const first=r.current.enterReview('score-1');first();exit=r.current.enterReview('score-1');});
  r.view.rerender(r.tree());await act(async()=>{});
  expect(r.current.reviewSession).toBe(session);expect(capture.exists()).toBe(true);
  act(()=>exit());await waitFor(()=>expect(capture.exists()).toBe(false));
  expect(capture.remove).toHaveBeenCalledOnce();expect(r.current.reviewSession).toBeNull();
});
it.each(['setup','practice','new-preparation','provider'] as const)('explicit %s transition releases Review ownership exactly once',async transition=>{
  const r=await rig();act(()=>r.current.updateProfile({...profile,mode:'CONTINUOUS_PLAY'}));
  const p=await r.prepare();act(()=>{r.current.commitPreparedPractice(p.value,p.transaction);});
  const capture=recordingSinkFixture();await capture.sink.append(new Blob(['capture']));const media=await capture.sink.seal('audio/webm');
  const recording={status:'READY' as const,kind:'AUDIO' as const,media,mimeType:'audio/webm',timebase:{nominalMediaDurationUs:10000000,activeSegments:[{performanceStartUs:0,performanceEndUs:10000000,mediaStartUs:0,mediaEndUs:10000000}]}};
  act(()=>{r.current.handoffToReview({result:reviewResult(p.value.bundle),recording},p.value.key);});await media.release();
  act(()=>{if(transition==='setup')r.current.enterSetup(p.value.key);if(transition==='practice')expect(r.current.enterPractice(p.value.key)).toBeNull();if(transition==='new-preparation')r.current.beginPreparation(p.value.key);if(transition==='provider')r.view.unmount();});
  await waitFor(()=>expect(capture.exists()).toBe(false));expect(capture.remove).toHaveBeenCalledOnce();
});
it('StrictMode effect replay preserves the environment and retained binding until final provider disposal',async()=>{
  const r=await rig(true),dispose=vi.spyOn(r.environment,'dispose'),p=await r.prepare(),close=vi.spyOn(p.value.binding,'close');
  act(()=>{r.current.commitPreparedPractice(p.value,p.transaction);});
  r.view.rerender(r.tree());await act(async()=>{});
  expect(close).not.toHaveBeenCalled();expect(dispose).not.toHaveBeenCalled();
  r.view.unmount();await waitFor(()=>expect(dispose).toHaveBeenCalledOnce());expect(close).toHaveBeenCalledOnce();
});
function reviewResult(source: {
  binding: import('@/lib/practice/bundle/admitted-practice-bundle').PracticeBundleBinding;
  artifact: import('@/lib/practice/score/artifact').PracticeScoreArtifact;
}) {
  const plan = Object.freeze({
    ...continuousPracticePlan(source.artifact),
    bundle: source,
  });
  return createContinuousPerformanceResult({
    session: completedContinuousSessionFixture(plan),
    evaluation: unavailableContinuousEvaluation(
      'MIDI',
      'CONTINUOUS_ANALYSIS_UNAVAILABLE',
    ),
  });
}
