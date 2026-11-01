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
import * as artifactContract from '@/lib/practice/kernel/artifact';

import { PracticeResourceBinding } from '@/lib/practice/device/practice-resource-binding';
import { browserDevicePlatform } from '@/lib/practice/device/browser-device-platform';
import { midiDeviceFixture } from '@/lib/practice/__fixtures__/device-roots';
import { usePracticeWorkspace } from '@/contexts/practice-workspace-context';
import { AcousticEngine } from '@/lib/practice/acoustic/model/acoustic-engine';
const admission = vi.hoisted(() => ({ request: vi.fn(), supported: true, events: [] as string[], revision: 'revision-id' as string | null }));
vi.mock('@/lib/api', () => ({ practiceApi: { getPracticeSource: (...args: unknown[]) => admission.request(...args) } }));
vi.mock('@/hooks/queries/use-score-queries', () => ({ useScoreDetail: () => ({ data: { data: { head_revision_id: 'head-id', capabilities: { can_practice: true } } }, isError: false }) }));
vi.mock('@/lib/practice/input-capability', () => ({
  evaluatePracticeInputCapabilities: () => { admission.events.push('capability'); return {}; },
  getSelectedInputCapability: () => ({ supported: admission.supported }),
}));
const navigation = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock('@/i18n/routing', () => ({ useRouter: () => navigation }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'score-id' }), usePathname: () => '/score/score-id/practice/setup',
  useSearchParams: () => new URLSearchParams(admission.revision ? `practiceRevisionId=${admission.revision}` : ''), useRouter: () => navigation }));
function envelope() { return { data: { source_id: 'source', artifact: { ...fixture, scoreId: 'score-id', revisionId: admission.revision ?? 'head-id' }, notation: null } }; }

beforeEach(() => {
  admission.supported = true; admission.revision = 'revision-id'; admission.events = [];
  admission.request.mockReset().mockImplementation(async () => { admission.events.push('source'); return envelope(); });
});
afterEach(() => { localStorage.clear(); navigation.replace.mockReset(); navigation.push.mockReset(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
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
  expect(admission.events).toEqual(['source','acquire','capability']);expect(parse).toHaveBeenCalledOnce();expect(r.acquireMidi).toHaveBeenCalledOnce();
  expect(r.workspace.preparedPractice!.binding.borrowRoots()!.midi).toBe(r.midi.access);
  expect(r.workspace.preparedPractice!.admission).toEqual({source:{sourceId:'source',scoreId:'score-id',revisionId:'revision-id',artifactId:fixture.artifactId},configuration:{mode:'STEP_BY_STEP',inputSource:'MIDI',recordingMode:'OFF'}});
  expect(Object.isFrozen(r.workspace.preparedPractice!.admission.source)).toBe(true);
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
  let resolve!:(value:ReturnType<typeof envelope>)=>void;admission.request.mockImplementation(()=>new Promise(r=>{resolve=r;}));const r=await setup();selectMidi();await start();
  expect(button()).toBeDisabled();expect(screen.getByRole('button',{name:'Microphone'})).toBeDisabled();fireEvent.click(button());expect(admission.request).toHaveBeenCalledOnce();
  r.view.unmount();await act(async()=>{resolve(envelope());});expect(r.acquireMidi).not.toHaveBeenCalled();expect(navigation.replace).not.toHaveBeenCalled();
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
