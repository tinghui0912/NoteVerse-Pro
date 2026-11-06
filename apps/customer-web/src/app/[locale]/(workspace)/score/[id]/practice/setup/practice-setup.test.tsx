// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en/practice.json';
import { PracticeWorkspaceProvider } from '@/contexts/practice-workspace-context';
import { DeviceFailure } from '@/lib/practice/failure/causal-failure';
import { PracticeEnvironment } from '@/lib/practice/environment/practice-environment';
import PracticeSetupPage from './page';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import * as artifactContract from '@/lib/practice/score/artifact';

import * as bindingOwner from '@/lib/practice/device/practice-resource-binding';
import { recordingProbeFixture } from '@/lib/practice/__fixtures__/recording-probe';
import { PracticeResourceBinding } from '@/lib/practice/device/practice-resource-binding';
import { browserDevicePlatform } from '@/lib/practice/device/browser-device-platform';
import { midiDeviceFixture } from '@/lib/practice/__fixtures__/device-roots';
import { usePracticeWorkspace } from '@/contexts/practice-workspace-context';
import { AcousticEngine } from '@/lib/practice/acoustic/model/acoustic-engine';
const admission = vi.hoisted(() => ({ request: vi.fn(), supported: true, events: [] as string[], revision: 'revision-id' as string | null }));
vi.mock('@/lib/api', () => ({ practiceApi: { getPracticeBundle: (...args: unknown[]) => admission.request(...args) } }));
vi.mock('@/hooks/queries/use-score-queries', () => ({ useScoreDetail: () => ({ data: { data: { head_revision_id: 'head-id', capabilities: { can_practice: true } } }, isError: false }) }));
vi.mock('@/lib/practice/input-capability', () => ({
  evaluatePracticeInputCapabilities: () => { admission.events.push('capability'); return {}; },
  getSelectedInputCapability: () => ({ supported: admission.supported }),
}));
const navigation = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock('@/i18n/routing', () => ({ useRouter: () => navigation }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'score-id' }), usePathname: () => '/score/score-id/practice/setup',
  useSearchParams: () => new URLSearchParams(admission.revision ? `practiceRevisionId=${admission.revision}` : ''), useRouter: () => navigation }));
function envelope() { return { data: { binding:{score_id:'score-id',revision_id:admission.revision ?? 'head-id',bundle_id:'bundle'}, artifact: fixture, notation: { musicxml: '<score />', mime_type: 'application/vnd.recordare.musicxml+xml' } } }; }

beforeEach(() => {
  admission.supported = true; admission.revision = 'revision-id'; admission.events = [];
  admission.request.mockReset().mockImplementation(async () => { admission.events.push('source'); return envelope(); });
});
afterEach(() => { localStorage.clear(); navigation.replace.mockReset(); navigation.push.mockReset(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function stream() {
  const stop=vi.fn(); const track=Object.assign(new EventTarget(), {kind:'audio',readyState:'live',muted:false,stop});
  const media={getTracks:()=>[track],getAudioTracks:()=>[track],getVideoTracks:()=>[]} as unknown as MediaStream;
  return {media,stop};
}
async function setup() {
  const midi=midiDeviceFixture(), microphone=stream();
  const acquireMidi=vi.spyOn(browserDevicePlatform,'acquireMidi').mockImplementation(async()=>{admission.events.push('acquire');return midi.access;});
  const acquireStream=vi.spyOn(browserDevicePlatform,'acquireStream').mockResolvedValue(microphone.media);
  const worker={load:vi.fn(async()=>({})),beginSession:vi.fn(async()=>{}),run:vi.fn(async()=>({events:[],inferenceMs:0,decodeMs:0,actualSessionRunCount:1})),endSession:vi.fn(async()=>{}),dispose:vi.fn(async()=>{}),terminate:vi.fn(),onFailure:()=>()=>{}};
  const platform={modelUrl:vi.fn(async()=>'/model'),createEngine:vi.fn(()=>new AcousticEngine(()=>worker)),validateCapture:vi.fn(async()=>{})};
  const environment=new PracticeEnvironment(platform), client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  let workspace!:ReturnType<typeof usePracticeWorkspace>;
  function Capture(){workspace=usePracticeWorkspace();return null;}
  const tree=(visible=true)=><QueryClientProvider client={client}><NextIntlClientProvider locale="en" messages={{practice:messages}}><PracticeWorkspaceProvider createEnvironment={()=>environment}><Capture/>{visible?<PracticeSetupPage/>:<p>Practice</p>}</PracticeWorkspaceProvider></NextIntlClientProvider></QueryClientProvider>;
  const view=render(tree());await act(async()=>{});
  return {environment,platform,view,tree,midi,microphone,acquireMidi,acquireStream,get workspace(){return workspace;}};
}
function selectMidi(){fireEvent.click(screen.getByRole('button',{name:/Step-by-step/}));fireEvent.click(screen.getByRole('button',{name:'MIDI keyboard'}));}
const button=()=>screen.getByRole('button',{name:messages.setupStartPractice});
async function start(){await waitFor(()=>expect(button()).toBeEnabled());await act(async()=>{fireEvent.click(button());});}
it('mount/configuration edits admit no source, acquire no physical roots and start no engine',async()=>{
  const r=await setup();selectMidi();fireEvent.click(screen.getByRole('button',{name:/Continuous play/}));fireEvent.click(screen.getByRole('button',{name:'Video'}));
  expect(admission.request).not.toHaveBeenCalled();expect(r.acquireMidi).not.toHaveBeenCalled();expect(r.acquireStream).not.toHaveBeenCalled();expect(r.platform.createEngine).not.toHaveBeenCalled();expect(navigation.replace).not.toHaveBeenCalled();
  expect(screen.getAllByRole('button').filter(b=>b.className.includes('bg-orange-600'))).toEqual([button()]);
  fireEvent.click(screen.getByRole('button',{name:messages.backToScore}));expect(navigation.push).toHaveBeenCalledWith('/score/score-id');
});
it('fresh Source parse precedes one physical acquisition, SAME-root validation, atomic commit and pinned navigation',async()=>{
  const parse=vi.spyOn(artifactContract,'parsePracticeScoreArtifact'),r=await setup();selectMidi();await start();
  expect(admission.request).toHaveBeenCalledExactlyOnceWith('score-id','revision-id',true,expect.any(AbortSignal));
  expect(admission.events).toEqual(['source','acquire','capability']);expect(parse).toHaveBeenCalledOnce();expect(r.acquireMidi).toHaveBeenCalledOnce();
  expect(r.workspace.preparedPractice!.binding.borrowRoots()!.midi).toBe(r.midi.access);
  expect(r.workspace.preparedPractice!.admission).toEqual({bundle:{binding: { scoreId: 'score-id', revisionId: 'revision-id', bundleId: 'bundle' },artifact:envelope().data.artifact,musicXml:'<score />'},configuration:{mode:'STEP_BY_STEP',inputSource:'MIDI',recordingMode:'OFF'}});
  expect(Object.isFrozen(r.workspace.preparedPractice!.admission.bundle)).toBe(true);
  expect(navigation.replace).toHaveBeenCalledWith('/score/score-id/practice?practiceRevisionId=revision-id');
});
it.each(['parser','server'] as const)('%s invalid score never acquires physical roots',async kind=>{
  if(kind==='parser')admission.request.mockResolvedValue({data:{...envelope().data,artifact:{...envelope().data.artifact,notes:[]}}});else admission.request.mockRejectedValue({code:'practice_score_invalid'});
  const r=await setup();selectMidi();await start();expect(screen.getByRole('alert')).toHaveTextContent(messages.scoreInvalid);expect(button()).toBeDisabled();
  expect(r.acquireMidi).not.toHaveBeenCalled();expect(r.acquireStream).not.toHaveBeenCalled();expect(r.workspace.preparedPractice).toBeNull();expect(navigation.replace).not.toHaveBeenCalled();
});
it('transport failure retries with a fresh source request using the same CTA',async()=>{
  admission.request.mockRejectedValueOnce(new Error('network'));const r=await setup();selectMidi();await start();expect(screen.getByRole('alert')).toHaveTextContent(messages.scoreLoadFailed);expect(r.acquireMidi).not.toHaveBeenCalled();
  await start();expect(admission.request).toHaveBeenCalledTimes(2);expect(r.acquireMidi).toHaveBeenCalledOnce();
});
it('capability failure after acquisition rolls back and cannot commit',async()=>{
  admission.supported=false;const r=await setup(),close=vi.spyOn(PracticeResourceBinding.prototype,'close');selectMidi();await start();
  expect(admission.events).toEqual(['source','acquire','capability']);expect(close).toHaveBeenCalled();expect(r.workspace.preparedPractice).toBeNull();expect(navigation.replace).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent(messages.setupFailure);
});
it('camera acquisition failure releases an already acquired microphone without changing VIDEO intent',async()=>{
  const r=await setup();r.acquireStream.mockResolvedValueOnce(r.microphone.media).mockRejectedValueOnce(new DeviceFailure('PERMISSION_DENIED','CAMERA'));
  fireEvent.click(screen.getByRole('button',{name:/Continuous play/}));fireEvent.click(screen.getByRole('button',{name:'Microphone'}));fireEvent.click(screen.getByRole('button',{name:'Video'}));await start();
  expect(r.microphone.stop).toHaveBeenCalledOnce();expect(r.workspace.preparedPractice).toBeNull();expect(r.platform.validateCapture).not.toHaveBeenCalled();expect(navigation.replace).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Video'})).toHaveAttribute('aria-pressed','true');
});
it('acoustic validation borrows the retained microphone, and a smoke failure closes it',async()=>{
  const r=await setup();r.platform.createEngine.mockImplementationOnce(()=>{throw new Error('smoke');});
  fireEvent.click(screen.getByRole('button',{name:/Step-by-step/}));fireEvent.click(screen.getByRole('button',{name:'Microphone'}));await start();
  expect(r.platform.validateCapture).toHaveBeenCalledWith(r.microphone.media,expect.any(AbortSignal));expect(r.acquireStream).toHaveBeenCalledOnce();expect(r.microphone.stop).toHaveBeenCalledOnce();expect(r.workspace.preparedPractice).toBeNull();expect(navigation.replace).not.toHaveBeenCalled();
});
it('source wait locks selectors, fences double click and prevents commit after unmount',async()=>{
  const construct=vi.spyOn(bindingOwner,'PracticeResourceBinding');
  let transport!:AbortSignal;let resolve!:(value:ReturnType<typeof envelope>)=>void;admission.request.mockImplementation((_score,_revision,_notation,signal:AbortSignal)=>{transport=signal;return new Promise(r=>{resolve=r;});});const r=await setup();selectMidi();await start();
  expect(button()).toBeDisabled();expect(screen.getByRole('button',{name:'Microphone'})).toBeDisabled();fireEvent.click(button());expect(admission.request).toHaveBeenCalledOnce();
  r.view.unmount();expect(transport.aborted).toBe(true);
  await act(async()=>{resolve(envelope());});expect(construct).not.toHaveBeenCalled();expect(r.workspace.preparedPractice).toBeNull();
  expect(r.acquireMidi).not.toHaveBeenCalled();expect(navigation.replace).not.toHaveBeenCalled();
});
it('unmount during acquisition closes a late stream and cannot navigate',async()=>{
  const r=await setup();let resolve!:(s:MediaStream)=>void;r.acquireStream.mockImplementation(()=>new Promise(done=>{resolve=done;}));
  fireEvent.click(screen.getByRole('button',{name:/Step-by-step/}));fireEvent.click(screen.getByRole('button',{name:'Microphone'}));await start();r.view.unmount();await act(async()=>{resolve(r.microphone.media);});
  expect(r.microphone.stop).toHaveBeenCalledOnce();expect(r.platform.validateCapture).not.toHaveBeenCalled();expect(navigation.replace).not.toHaveBeenCalled();
});
it('returning to Setup releases admission, stays idle and requires another fresh preparation',async()=>{
  const r=await setup();selectMidi();await start();const first=r.workspace.preparedPractice!;
  r.view.rerender(r.tree(false));r.view.rerender(r.tree());await act(async()=>{});expect(first.binding.snapshot().state).toBe('CLOSED');expect(r.workspace.preparedPractice).toBeNull();
  expect(admission.request).toHaveBeenCalledOnce();expect(screen.getByText('MIDI keyboard: Not prepared')).toBeVisible();await start();expect(admission.request).toHaveBeenCalledTimes(2);expect(r.acquireMidi).toHaveBeenCalledTimes(2);
});
it('a new explicit command releases the prior binding before opening its replacement',async()=>{
  const r=await setup();selectMidi();await start();const previous=r.workspace.preparedPractice!;
  r.view.rerender(r.tree(false)); r.view.rerender(r.tree());
  r.acquireMidi.mockImplementationOnce(async()=>{expect(previous.binding.snapshot().state).toBe('CLOSED');return r.midi.access;});await start();expect(r.workspace.preparedPractice!.binding).not.toBe(previous.binding);
});
it('pins a direct Setup URL without admitting a source',async()=>{
  admission.revision=null;const r=await setup();expect(navigation.replace).toHaveBeenCalledWith('/score/score-id/practice/setup?practiceRevisionId=head-id',{scroll:false});expect(admission.request).not.toHaveBeenCalled();expect(r.acquireMidi).not.toHaveBeenCalled();
});

it('resource configuration replacement aborts a validating transaction and closes its original roots',async()=>{
  const r=await setup();let finish!:()=>void;r.platform.validateCapture.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  fireEvent.click(screen.getByRole('button',{name:/Step-by-step/}));fireEvent.click(screen.getByRole('button',{name:'Microphone'}));await start();
  await waitFor(()=>expect(finish).toBeTypeOf('function'));
  act(()=>r.workspace.updateProfile({...r.workspace.profile,inputSource:'MIDI'}));
  expect(r.microphone.stop).toHaveBeenCalledOnce();await act(async()=>{finish();});
  expect(r.workspace.preparedPractice).toBeNull();expect(navigation.replace).not.toHaveBeenCalled();
});

it('superseded recording validation releases A immediately, lets B commit and ignores late A callbacks',async()=>{
  const r=await setup(),probe=recordingProbeFixture(),first=probe.root('audio'),second=probe.root('audio'),camera=probe.root('video');
  r.acquireStream.mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream).mockResolvedValueOnce(camera.stream);
  fireEvent.click(screen.getByRole('button',{name:/Continuous play/}));fireEvent.click(screen.getByRole('button',{name:'MIDI keyboard'}));fireEvent.click(screen.getByRole('button',{name:'Audio'}));
  vi.useFakeTimers();const time=Date.now();
  const open=vi.spyOn(PracticeResourceBinding.prototype,'open');
  await act(async()=>{fireEvent.click(button());await vi.advanceTimersByTimeAsync(0);});
  expect(probe.instances).toHaveLength(1);const a=probe.instances[0],lateStop=a.onstop!,lateError=a.onerror!;
  const bindingA=open.mock.contexts[0] as PracticeResourceBinding;expect(bindingA.borrowRoots()!.recordingMicrophone).toBe(first.stream);
  expect(button()).toBeDisabled();expect(r.workspace.preparedPractice).toBeNull();
  await act(async()=>{r.workspace.updateProfile({...r.workspace.profile,continuous:{...r.workspace.profile.continuous,recordingMode:'VIDEO'}});await vi.advanceTimersByTimeAsync(0);});
  expect(a).toMatchObject({onstop:null,onerror:null,ondataavailable:null});expect(a.stop).toHaveBeenCalledTimes(2);
  expect(first.track.clones[0].stop).toHaveBeenCalledOnce();expect(first.track.stop).toHaveBeenCalledOnce();expect(bindingA.snapshot().state).toBe('CLOSED');
  expect(screen.getByRole('button',{name:'Video'})).toHaveAttribute('aria-pressed','true');
  expect(screen.queryByRole('alert')).toBeNull();expect(button()).toBeEnabled();
  admission.request.mockResolvedValueOnce({data:{...envelope().data,binding:{...envelope().data.binding,bundle_id:'bundle-B'}}});
  await act(async()=>{fireEvent.click(button());await vi.advanceTimersByTimeAsync(0);});
  expect(probe.instances).toHaveLength(2);const b=probe.instances[1];b.completeOnStop=true;
  await act(async()=>{b.stop();await vi.advanceTimersByTimeAsync(0);});
  const prepared=r.workspace.preparedPractice!;expect(prepared.admission.bundle.binding.bundleId).toBe('bundle-B');
  expect(prepared.binding.borrowRoots()!.recordingMicrophone).toBe(second.stream);expect(prepared.binding.snapshot().state).toBe('READY');
  for(const root of [second,camera]){expect(root.track.clones[0].stop).toHaveBeenCalledOnce();expect(root.track.stop).not.toHaveBeenCalled();}
  expect(r.acquireStream).toHaveBeenCalledTimes(3);
  expect(Date.now()).toBe(time);expect(navigation.replace).toHaveBeenCalledExactlyOnceWith('/score/score-id/practice?practiceRevisionId=revision-id');
  await act(async()=>{lateError();lateStop();await vi.advanceTimersByTimeAsync(0);});
  expect(r.workspace.preparedPractice).toBe(prepared);for(const root of [second,camera])expect(root.track.stop).not.toHaveBeenCalled();expect(screen.queryByRole('alert')).toBeNull();
  expect(navigation.replace).toHaveBeenCalledOnce();
});
