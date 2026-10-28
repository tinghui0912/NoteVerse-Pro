// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en/practice.json';
import { PracticeWorkspaceProvider } from '@/contexts/practice-workspace-context';
import { PracticeEnvironment } from '@/lib/practice/environment/practice-environment';
import { PRACTICE_PREFERENCES_KEY } from '@/lib/practice/configuration/preference-storage';
import PracticeSetupPage from './page';
import { readFileSync } from 'node:fs';
import { probePracticeRequirements } from '@/lib/practice/environment/browser-readiness-probes';
import { browserMicrophoneCapture } from '@/lib/practice/acoustic/source/browser-microphone-platform';
import { AcousticEngine } from '@/lib/practice/acoustic/model/acoustic-engine';
import { midiDeviceFixture } from '@/lib/practice/__fixtures__/device-roots';

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'score-id' }),
  useSearchParams: () => new URLSearchParams('practiceRevisionId=revision-id'), useRouter: () => navigation }));
afterEach(() => { localStorage.clear(); navigation.replace.mockReset(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup() {
  const platform = { modelUrl: vi.fn(), createEngine: vi.fn(),
    probe: vi.fn(async (requirements: readonly string[], ready: (key: never) => void) => requirements.forEach(key => ready(key as never))) };
  const environment = new PracticeEnvironment(platform);
  render(<NextIntlClientProvider locale="en" messages={{ practice: messages }}>
    <PracticeWorkspaceProvider createEnvironment={() => environment}><PracticeSetupPage /></PracticeWorkspaceProvider>
  </NextIntlClientProvider>);
  return { platform, environment };
}
it('requires explicit first-use selections and prepares MIDI without any acoustic prerequisite', async () => {
  const r = setup();
  expect(screen.getByRole('button', { name: 'Prepare practice' })).toBeDisabled();
  expect(screen.getByRole('button', { name: /Step-by-step/ })).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(screen.getByRole('button', { name: /Step-by-step/ }));
  fireEvent.click(screen.getByRole('button', { name: 'MIDI keyboard' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Prepare practice' })).toBeEnabled());
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Prepare practice' })); });
  expect(r.platform.probe.mock.calls[0][0]).toEqual(['midi']); expect(r.platform.createEngine).not.toHaveBeenCalled();
  expect(navigation.replace).toHaveBeenCalledWith('/score/score-id/practice?practiceRevisionId=revision-id');
  fireEvent.click(screen.getByRole('button', { name: /Continuous play/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Video' }));
  expect(screen.getByText('MIDI keyboard: Not prepared')).toBeVisible();
  expect(screen.queryByText('MIDI keyboard: Ready')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Prepare practice' })).toBeEnabled();
});
it('requires explicit Continuous recording and keeps VIDEO intent when camera preparation fails', async () => {
  const r = setup(); r.platform.probe.mockRejectedValueOnce(new Error('CAMERA_PERMISSION_DENIED'));
  fireEvent.click(screen.getByRole('button', { name: /Continuous play/ }));
  fireEvent.click(screen.getByRole('button', { name: 'MIDI keyboard' }));
  await act(async () => {});
  expect(screen.getByRole('button', { name: 'Prepare practice' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Video' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Prepare practice' })); });
  expect(r.environment.snapshot().status).toBe('BLOCKED');
  expect(JSON.parse(localStorage.getItem(PRACTICE_PREFERENCES_KEY)!).continuous.recordingMode).toBe('VIDEO');
  expect(screen.getByRole('button', { name: 'Video' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('alert')).toHaveTextContent('Check browser permissions'); expect(navigation.replace).not.toHaveBeenCalled();
});

it('Setup owns readiness configuration and exposes no presentation-feedback control', async () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: /Continuous play/ }));
  for (const name of ['MIDI keyboard', 'Microphone', 'Audio', 'Video']) expect(screen.getByRole('button', { name })).toBeVisible();
  expect(screen.queryByRole('switch')).toBeNull(); expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByText(messages.liveNoteFeedback)).toBeNull();
});

for (const input of ['MIDI', 'MICROPHONE'] as const) it(`${input}: READY Setup always prepares fresh browser probes, reuses the warm engine, and blocks only on denied probes`, async () => {
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
  render(<NextIntlClientProvider locale="en" messages={{practice:messages}}><PracticeWorkspaceProvider createEnvironment={()=>environment}><PracticeSetupPage /></PracticeWorkspaceProvider></NextIntlClientProvider>);
  fireEvent.click(screen.getByRole('button',{name:/Step-by-step/}));
  fireEvent.click(screen.getByRole('button',{name: input==='MIDI'?'MIDI keyboard':'Microphone'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Prepare practice'})).toBeEnabled());
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Prepare practice'}));});
  await waitFor(()=>expect(environment.snapshot().status).toBe('READY'));
  const acquisition = input==='MIDI'?requestMIDIAccess:getUserMedia;
  expect(acquisition).toHaveBeenCalledOnce(); expect(environment.snapshot().status).toBe('READY');
  navigation.replace.mockClear();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(environment.snapshot().status).toBe('READY');
  expect(screen.getByRole('button',{name:'Prepare practice'})).toBeEnabled();
  expect(acquisition).toHaveBeenCalledOnce(); // Remaining on/directly entering READY Setup acquires nothing.
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Prepare practice'}));});
  await waitFor(()=>expect(environment.snapshot().status).toBe('READY'));
  expect(acquisition).toHaveBeenCalledTimes(2);
  if(input==='MICROPHONE') { expect(connect).toHaveBeenCalledTimes(2); expect(createEngine).toHaveBeenCalledOnce(); expect(modelUrl).toHaveBeenCalledOnce(); expect(worker.load).toHaveBeenCalledOnce(); }
  navigation.replace.mockClear();
  denied=true;
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Prepare practice'}));});
  expect(acquisition).toHaveBeenCalledTimes(3); expect(environment.snapshot().status).toBe('BLOCKED');
  expect(navigation.replace).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toBeVisible();
  denied=false;
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Prepare practice'}));});
  await waitFor(()=>expect(environment.snapshot().status).toBe('READY'));
  expect(acquisition).toHaveBeenCalledTimes(4); expect(environment.snapshot().status).toBe('READY');
  expect(navigation.replace).toHaveBeenCalledWith('/score/score-id/practice?practiceRevisionId=revision-id');
  if(input==='MICROPHONE') { expect(connect).toHaveBeenCalledTimes(3); expect(captureStop).toHaveBeenCalledTimes(3); expect(close).toHaveBeenCalledTimes(3); expect(stop).toHaveBeenCalledTimes(3); expect(createEngine).toHaveBeenCalledOnce(); expect(modelUrl).toHaveBeenCalledOnce(); expect(worker.load).toHaveBeenCalledOnce(); }
  else { expect(getUserMedia).not.toHaveBeenCalled(); expect(connect).not.toHaveBeenCalled(); }
});

it('direct Setup render with already READY shared evidence has only Prepare and cannot bypass probes', async () => {
  localStorage.setItem(PRACTICE_PREFERENCES_KEY, JSON.stringify({schemaVersion:1, mode:'STEP_BY_STEP', inputSource:'MIDI', continuous:{recordingMode:'OFF', liveFeedbackEnabled:false}}));
  const probe = vi.fn(async (_requirements: readonly string[], ready: (key: 'midi') => void) => { ready('midi'); });
  const environment = new PracticeEnvironment({modelUrl:vi.fn(), createEngine:vi.fn(), probe});
  await environment.requalify(['midi']); expect(probe).toHaveBeenCalledOnce();
  render(<NextIntlClientProvider locale="en" messages={{practice:messages}}><PracticeWorkspaceProvider createEnvironment={()=>environment}><PracticeSetupPage /></PracticeWorkspaceProvider></NextIntlClientProvider>);
  await waitFor(()=>expect(screen.getByRole('button',{name:messages.setupPrepare})).toBeEnabled());
  expect(environment.snapshot().status).toBe('READY'); expect(screen.queryByRole('alert')).toBeNull();
  expect(navigation.replace).not.toHaveBeenCalled(); expect(probe).toHaveBeenCalledOnce();
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:messages.setupPrepare}));});
  expect(probe).toHaveBeenCalledTimes(2);
  expect(navigation.replace).toHaveBeenCalledWith('/score/score-id/practice?practiceRevisionId=revision-id');
});
