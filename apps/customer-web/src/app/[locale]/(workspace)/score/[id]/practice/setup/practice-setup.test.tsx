// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en/practice.json';
import { PracticeWorkspaceProvider } from '@/contexts/practice-workspace-context';
import { DeviceFailure } from '@/lib/practice/failure/causal-failure';
import { PracticeEnvironment } from '@/lib/practice/environment/practice-environment';
import { PRACTICE_PREFERENCES_KEY } from '@/lib/practice/configuration/preference-storage';
import PracticeSetupPage from './page';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import * as artifactContract from '@/lib/practice/kernel/artifact';

import { readFileSync } from 'node:fs';
import { probePracticeRequirements } from '@/lib/practice/environment/browser-readiness-probes';
import { browserMicrophoneCapture } from '@/lib/practice/acoustic/source/browser-microphone-platform';
import { AcousticEngine } from '@/lib/practice/acoustic/model/acoustic-engine';
import { PracticeDeviceLease } from '@/lib/practice/device/practice-device-lease';
import { StepPracticeController } from '@/lib/practice/step/step-practice-controller';
import { ContinuousPracticeController } from '@/lib/practice/continuous/continuous-practice-controller';
import { midiDeviceFixture } from '@/lib/practice/__fixtures__/device-roots';

const admission = vi.hoisted(() => ({ request: vi.fn(), supported: true, events: [] as string[], revision: 'revision-id' as string | null }));
vi.mock('@/lib/api', () => ({ practiceApi: { getPracticeSource: (...args: unknown[]) => admission.request(...args) } }));
vi.mock('@/hooks/queries/use-score-queries', () => ({ useScoreDetail: () => ({
  data: { data: { head_revision_id: 'head-id', capabilities: { can_practice: true } } }, isError: false,
}) }));
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
function tree(environment: PracticeEnvironment, client = new QueryClient({ defaultOptions: { queries: { retry: false } } }), showSetup = true) {
  return <QueryClientProvider client={client}><NextIntlClientProvider locale="en" messages={{ practice: messages }}>
    <PracticeWorkspaceProvider createEnvironment={() => environment}>{showSetup ? <PracticeSetupPage /> : <p>Practice</p>}</PracticeWorkspaceProvider>
  </NextIntlClientProvider></QueryClientProvider>;
}
async function setup() {
  const platform = { modelUrl: vi.fn(), createEngine: vi.fn(),
    probe: vi.fn(async (requirements: readonly string[], ready: (key: never) => void) => { admission.events.push('probe'); requirements.forEach(key => ready(key as never)); }) };
  const environment = new PracticeEnvironment(platform);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(tree(environment, client));
  await act(async () => {});
  return { platform, environment, view, client };
}
it('requires explicit first-use selections and prepares MIDI without any acoustic prerequisite', async () => {
  const r = await setup();
  expect(screen.getByRole('button', { name: 'Start practice' })).toBeDisabled();
  expect(screen.getByRole('button', { name: /Step-by-step/ })).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(screen.getByRole('button', { name: /Step-by-step/ }));
  fireEvent.click(screen.getByRole('button', { name: 'MIDI keyboard' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start practice' })).toBeEnabled());
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start practice' })); });
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/score/score-id/practice?practiceRevisionId=revision-id'));
  expect(r.platform.probe.mock.calls[0][0]).toEqual(['midi']); expect(r.platform.createEngine).not.toHaveBeenCalled();
  expect(navigation.replace).toHaveBeenCalledWith('/score/score-id/practice?practiceRevisionId=revision-id');
  fireEvent.click(screen.getByRole('button', { name: /Continuous play/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Video' }));
  expect(screen.getByText('MIDI keyboard: Not prepared')).toBeVisible();
  expect(screen.queryByText('MIDI keyboard: Ready')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Start practice' })).toBeEnabled();
});
it('requires explicit Continuous recording and keeps VIDEO intent when camera preparation fails', async () => {
  const r = await setup(); r.platform.probe.mockRejectedValueOnce(new DeviceFailure('PERMISSION_DENIED', 'CAMERA'));
  fireEvent.click(screen.getByRole('button', { name: /Continuous play/ }));
  fireEvent.click(screen.getByRole('button', { name: 'MIDI keyboard' }));
  await act(async () => {});
  expect(screen.getByRole('button', { name: 'Start practice' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Video' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start practice' })); });
  await waitFor(() => expect(r.environment.snapshot().status).toBe('BLOCKED'));
  expect(JSON.parse(localStorage.getItem(PRACTICE_PREFERENCES_KEY)!).continuous.recordingMode).toBe('VIDEO');
  expect(screen.getByRole('button', { name: 'Video' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('alert')).toHaveTextContent('Check browser permissions'); expect(navigation.replace).not.toHaveBeenCalled();
});

it('Setup owns readiness configuration and exposes no presentation-feedback control', async () => {
  await setup();
  fireEvent.click(screen.getByRole('button', { name: /Continuous play/ }));
  for (const name of ['MIDI keyboard', 'Microphone', 'Audio', 'Video']) expect(screen.getByRole('button', { name })).toBeVisible();
  expect(screen.queryByRole('switch')).toBeNull(); expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByText(messages.liveNoteFeedback)).toBeNull();
});

for (const input of ['MIDI', 'MICROPHONE'] as const) it(`${input}: Setup commands prepare fresh browser probes, reuses the warm engine, and blocks only on denied probes`, async () => {
  let denied = false;
  const stop = vi.fn(), track = { kind:'audio', readyState:'live', muted:false, stop };
  const stream = { getTracks:()=>[track], getAudioTracks:()=>[track] } as unknown as MediaStream;
  const getUserMedia = vi.fn(async () => { if (denied) throw new DOMException('blocked','NotAllowedError'); return stream; });
  const midi = midiDeviceFixture();
  const requestMIDIAccess = vi.fn(async () => { if (denied) throw new DOMException('blocked','NotAllowedError'); return midi.access; });
  vi.stubGlobal('navigator', { requestMIDIAccess, mediaDevices:{getUserMedia} });
  const close = vi.fn(async () => {}), captureStop = vi.fn();
  vi.stubGlobal('AudioContext', class { state='running'; sampleRate=48000; resume=async()=>{}; close=close; });
  vi.spyOn(browserMicrophoneCapture,'coefficients').mockResolvedValue(readFileSync('public/model-assets/practice-acoustic/fir-1-3.f32'));
  const connect = vi.spyOn(browserMicrophoneCapture,'connectCapture').mockResolvedValue({stop:captureStop});
  const worker = { load:vi.fn(async()=>({})), beginSession:vi.fn(async()=>{}), run:vi.fn(async()=>({events:[],inferenceMs:0,decodeMs:0,actualSessionRunCount:1})),
    endSession:vi.fn(async()=>{}), dispose:vi.fn(async()=>{}), terminate:vi.fn(), onFailure:()=>()=>{} };
  const modelUrl = vi.fn(async()=>'/verified-model'), createEngine = vi.fn(()=>new AcousticEngine(()=>worker));
  const environment = new PracticeEnvironment({ modelUrl, createEngine, probe:probePracticeRequirements });
  render(tree(environment));
  await act(async () => {});
  fireEvent.click(screen.getByRole('button',{name:/Step-by-step/}));
  fireEvent.click(screen.getByRole('button',{name: input==='MIDI'?'MIDI keyboard':'Microphone'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Start practice'})).toBeEnabled());
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Start practice'}));});
  await waitFor(()=>expect(environment.snapshot().status).toBe('READY'));
  const acquisition = input==='MIDI'?requestMIDIAccess:getUserMedia;
  expect(acquisition).toHaveBeenCalledOnce(); expect(environment.snapshot().status).toBe('READY');
  navigation.replace.mockClear();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(environment.snapshot().status).toBe('READY');
  expect(screen.getByRole('button',{name:'Start practice'})).toBeEnabled();
  expect(acquisition).toHaveBeenCalledOnce(); // Remaining on/directly entering READY Setup acquires nothing.
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Start practice'}));});
  await waitFor(()=>expect(environment.snapshot().status).toBe('READY'));
  expect(acquisition).toHaveBeenCalledTimes(2);
  if(input==='MICROPHONE') { expect(connect).toHaveBeenCalledTimes(2); expect(createEngine).toHaveBeenCalledOnce(); expect(modelUrl).toHaveBeenCalledOnce(); expect(worker.load).toHaveBeenCalledOnce(); }
  navigation.replace.mockClear();
  denied=true;
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Start practice'}));});
  expect(acquisition).toHaveBeenCalledTimes(3); expect(environment.snapshot().status).toBe('BLOCKED');
  expect(navigation.replace).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toBeVisible();
  denied=false;
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Start practice'}));});
  await waitFor(()=>expect(environment.snapshot().status).toBe('READY'));
  expect(acquisition).toHaveBeenCalledTimes(4); expect(environment.snapshot().status).toBe('READY');
  expect(navigation.replace).toHaveBeenCalledWith('/score/score-id/practice?practiceRevisionId=revision-id');
  if(input==='MICROPHONE') { expect(connect).toHaveBeenCalledTimes(3); expect(captureStop).toHaveBeenCalledTimes(3); expect(close).toHaveBeenCalledTimes(3); expect(stop).toHaveBeenCalledTimes(3); expect(createEngine).toHaveBeenCalledOnce(); expect(modelUrl).toHaveBeenCalledOnce(); expect(worker.load).toHaveBeenCalledOnce(); }
  else { expect(getUserMedia).not.toHaveBeenCalled(); expect(connect).not.toHaveBeenCalled(); }
});

it('a fresh visit shows unprepared components even when the shared Environment is READY', async () => {
  localStorage.setItem(PRACTICE_PREFERENCES_KEY, JSON.stringify({schemaVersion:1, mode:'STEP_BY_STEP', inputSource:'MIDI', continuous:{recordingMode:'OFF', liveFeedbackEnabled:false}}));
  const probe = vi.fn(async (_requirements: readonly string[], ready: (key: 'midi') => void) => { ready('midi'); });
  const environment = new PracticeEnvironment({modelUrl:vi.fn(), createEngine:vi.fn(), probe});
  await environment.requalify(['midi']); expect(probe).toHaveBeenCalledOnce();
  render(tree(environment));
  await act(async () => {});
  await waitFor(()=>expect(screen.getByRole('button',{name:messages.setupStartPractice})).toBeEnabled());
  expect(environment.snapshot().status).toBe('READY'); expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('MIDI keyboard: Not prepared')).toBeVisible();
  expect(navigation.replace).not.toHaveBeenCalled(); expect(probe).toHaveBeenCalledOnce();
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:messages.setupStartPractice}));});
  expect(probe).toHaveBeenCalledTimes(2);
  expect(navigation.replace).toHaveBeenCalledWith('/score/score-id/practice?practiceRevisionId=revision-id');
});

function selectMidi() {
  fireEvent.click(screen.getByRole('button', { name: /Step-by-step/ }));
  fireEvent.click(screen.getByRole('button', { name: 'MIDI keyboard' }));
}
const startButton = () => screen.getByRole('button', { name: messages.setupStartPractice });
async function start() {
  await waitFor(() => expect(startButton()).toBeEnabled());
  await act(async () => { fireEvent.click(startButton()); });
}
it('mount and configuration edits perform no Source admission, qualification or navigation', async () => {
  const open = vi.spyOn(PracticeDeviceLease.prototype, 'open'), step = vi.spyOn(StepPracticeController.prototype, 'start'), continuous = vi.spyOn(ContinuousPracticeController.prototype, 'start');
  const r = await setup(); selectMidi();
  await waitFor(() => expect(startButton()).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: /Continuous play/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Video' }));
  expect(admission.request).not.toHaveBeenCalled(); expect(r.platform.probe).not.toHaveBeenCalled();
  expect(r.platform.createEngine).not.toHaveBeenCalled(); expect(navigation.replace).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled(); expect(step).not.toHaveBeenCalled(); expect(continuous).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: messages.backToScore })).toBeVisible();
  expect(screen.getAllByRole('button').filter(button => button.className.includes('bg-orange-600'))).toEqual([startButton()]);
  fireEvent.click(screen.getByRole('button', { name: messages.backToScore }));
  expect(navigation.push).toHaveBeenCalledWith('/score/score-id');
});
it('a fresh Source request and strict parse precede capability and Environment qualification on every click', async () => {
  const parse = vi.spyOn(artifactContract, 'parsePracticeScoreArtifact');
  const r = await setup(); selectMidi();
  expect(admission.request).not.toHaveBeenCalled(); await start();
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledTimes(1));
  await start();
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledTimes(2));
  expect(admission.events).toEqual(['source', 'capability', 'probe', 'source', 'capability', 'probe']);
  expect(parse).toHaveBeenCalledTimes(2); expect(r.platform.probe).toHaveBeenCalledTimes(2);
  expect(admission.request).toHaveBeenNthCalledWith(1, 'score-id', 'revision-id', false, expect.any(AbortSignal));
  expect(navigation.replace).toHaveBeenLastCalledWith('/score/score-id/practice?practiceRevisionId=revision-id');
});
it.each(['parser', 'server'] as const)('%s invalid revision fails before capability or qualification', async kind => {
  if (kind === 'parser') admission.request.mockResolvedValue({ data: { ...envelope().data, artifact: { ...envelope().data.artifact, notes: [] } } });
  else admission.request.mockRejectedValue({ code: 'practice_score_invalid' });
  const r = await setup(); selectMidi(); await start();
  expect(screen.getByRole('alert')).toHaveTextContent(messages.scoreInvalid); expect(startButton()).toBeDisabled();
  expect(admission.request).toHaveBeenCalledOnce(); expect(admission.events).toEqual([]);
  expect(r.platform.probe).not.toHaveBeenCalled(); expect(r.platform.createEngine).not.toHaveBeenCalled();
  expect(navigation.replace).not.toHaveBeenCalled();
});
it('a transient Source failure stays retryable through the same CTA and a fresh second request', async () => {
  admission.request.mockRejectedValueOnce(new Error('network'));
  const r = await setup(); selectMidi(); await start();
  expect(screen.getByRole('alert')).toHaveTextContent(messages.scoreLoadFailed);
  expect(r.platform.probe).not.toHaveBeenCalled(); expect(navigation.replace).not.toHaveBeenCalled();
  await start(); expect(admission.request).toHaveBeenCalledTimes(2); expect(r.platform.probe).toHaveBeenCalledOnce();
});
it('unsupported current input capability blocks qualification and navigation after Score admission', async () => {
  admission.supported = false; const r = await setup(); selectMidi(); await start();
  expect(admission.events).toEqual(['source', 'capability']); expect(screen.getByRole('alert')).toHaveTextContent(messages.setupFailure);
  expect(r.platform.probe).not.toHaveBeenCalled(); expect(navigation.replace).not.toHaveBeenCalled();
});
it('locks configuration during Source admission and fences double clicks and unmounted completion', async () => {
  let resolve!: (value: ReturnType<typeof envelope>) => void;
  admission.request.mockImplementation(() => new Promise(r => { resolve = r; }));
  const r = await setup(); selectMidi(); await start();
  expect(startButton()).toBeDisabled(); expect(screen.getByRole('button', { name: 'Microphone' })).toBeDisabled();
  expect(screen.getByRole('button', { name: /Continuous play/ })).toBeDisabled();
  fireEvent.click(startButton()); expect(admission.request).toHaveBeenCalledOnce();
  r.view.unmount(); await act(async () => { resolve(envelope()); });
  expect(r.platform.probe).not.toHaveBeenCalled(); expect(navigation.replace).not.toHaveBeenCalled();
});
it('locks through qualification and stale qualification completion cannot navigate', async () => {
  let release!: () => void;
  const r = await setup(); r.platform.probe.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
  selectMidi(); await start(); expect(startButton()).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Microphone' })).toBeDisabled();
  await waitFor(() => expect(release).toBeTypeOf('function'));
  r.view.unmount(); await act(async () => { release(); });
  expect(navigation.replace).not.toHaveBeenCalled();
});
it('pins a direct Setup URL without admitting Source', async () => {
  admission.revision = null; const r = await setup(); await act(async () => {});
  expect(navigation.replace).toHaveBeenCalledWith('/score/score-id/practice/setup?practiceRevisionId=head-id', { scroll: false });
  expect(admission.request).not.toHaveBeenCalled(); expect(r.platform.probe).not.toHaveBeenCalled();
});
it('a different pinned revision clears deterministic invalid presentation', async () => {
  admission.request.mockResolvedValueOnce({ data: { ...envelope().data, artifact: { ...envelope().data.artifact, notes: [] } } });
  const r = await setup(); selectMidi(); await start(); expect(startButton()).toBeDisabled();
  admission.revision = 'another-revision'; r.view.rerender(tree(r.environment));
  await waitFor(() => expect(startButton()).toBeEnabled()); expect(screen.queryByRole('alert')).toBeNull();
  await start(); expect(navigation.replace).toHaveBeenCalledWith('/score/score-id/practice?practiceRevisionId=another-revision');
});

it('returning to Setup with cached Source and warm READY evidence presents idle and still refetches', async () => {
  const r = await setup(); selectMidi(); await start();
  expect(admission.request).toHaveBeenCalledOnce(); expect(r.environment.snapshot().status).toBe('READY');
  r.view.rerender(tree(r.environment, r.client, false));
  r.view.rerender(tree(r.environment, r.client));
  expect(screen.getByText('MIDI keyboard: Not prepared')).toBeVisible();
  expect(admission.request).toHaveBeenCalledOnce(); expect(r.platform.probe).toHaveBeenCalledOnce();
  await start(); expect(admission.request).toHaveBeenCalledTimes(2); expect(r.platform.probe).toHaveBeenCalledTimes(2);
});
