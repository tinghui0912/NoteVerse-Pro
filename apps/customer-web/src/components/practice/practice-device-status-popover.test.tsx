// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import en from '../../../messages/en/practice.json';
import zh from '../../../messages/zh/practice.json';
import type { PracticeDeviceHealth, PracticeDeviceIssue } from '@/lib/practice/device/device-contract';
import { midiDeviceFixture } from '@/lib/practice/__fixtures__/device-roots';
import { usePracticeDeviceLease } from '@/hooks/practice/use-practice-device-lease';
import { PracticeDeviceStatusPopover } from './practice-device-status-popover';
import { PracticeStatus } from './practice-status';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
for (const [locale, messages] of [['en', en], ['zh', zh]] as const) {
  for (const resource of ['inputMicrophone', 'recordingMicrophone', 'camera', 'midi'] as const) {
    for (const condition of ['HEALTHY', 'INTERRUPTED', 'LOST', 'PERMISSION_DENIED', 'NOT_FOUND', 'BUSY', 'UNAVAILABLE'] as const) {
      it(`${locale} ${resource} ${condition}: accessible state with only meaningful Reconnect`, () => {
        const issue: PracticeDeviceIssue | null = condition === 'HEALTHY' ? null : { resource, phase: 'OPEN', condition };
        const health: PracticeDeviceHealth = condition === 'HEALTHY' ? 'HEALTHY' : condition === 'INTERRUPTED' ? 'INTERRUPTED' : 'LOST';
        const resourceLabel = messages[`deviceResource_${resource}`];
        const label = (condition === 'HEALTHY' ? messages.deviceStatusReady : messages.deviceStatusUnavailable).replace('{resource}', resourceLabel);
        const reconnect = vi.fn(async () => {});
        render(<NextIntlClientProvider locale={locale} messages={{ practice: messages }}>
          <PracticeDeviceStatusPopover {...{resource,health,issue}} canReconnect onReconnect={reconnect} />
        </NextIntlClientProvider>);
        const trigger = screen.getByRole('button', { name: label });
        expect(trigger).toHaveClass(condition === 'HEALTHY' ? 'text-emerald-600' : 'text-rose-600');
        if (resource.includes('Microphone')) expect(trigger.querySelector('svg')).toHaveClass('lucide-mic');
        fireEvent.click(trigger);
        const popover = screen.getByRole('dialog', { name: resourceLabel });
        const count = condition === 'HEALTHY' || condition === 'INTERRUPTED' ? 0 : 1;
        expect(within(popover).queryAllByRole('button', { name: messages.deviceReconnect })).toHaveLength(count);
        expect(within(popover).queryAllByRole('button')).toHaveLength(count);
        expect(popover).not.toHaveTextContent(messages.setupChangeConfiguration);
        if (condition === 'PERMISSION_DENIED') expect(popover).toHaveTextContent(messages.devicePermissionDenied.replace('{resource}', resourceLabel));
        expect(reconnect).not.toHaveBeenCalled();
      });
    }
  }
  it(`${locale}: healthy → lost → denied keeps the identical status shell`, () => {
    const status = (issue: PracticeDeviceIssue | null) => <NextIntlClientProvider locale={locale} messages={{practice:messages}}>
      <PracticeStatus lifecycle="ACTIVE" sessionMode="STEP_BY_STEP" inputSource="MICROPHONE" stepInteractionPhase="READY"
        deviceIssue={issue} deviceControls={<PracticeDeviceStatusPopover resource="inputMicrophone" health={issue ? 'LOST' : 'HEALTHY'} issue={issue} canReconnect onReconnect={async()=>{}} />} />
    </NextIntlClientProvider>;
    const view = render(status(null)), shell = screen.getByTestId('practice-status'), classes = shell.className;
    expect(shell).toHaveTextContent(messages.stepMicrophoneReady);
    for (const condition of ['LOST', 'PERMISSION_DENIED'] as const) {
      view.rerender(status({resource:'inputMicrophone',phase:'RUNTIME',condition}));
      expect(screen.getByTestId('practice-status')).toBe(shell); expect(shell.className).toBe(classes);
      expect(shell).not.toHaveTextContent(messages.stepMicrophoneReady); expect(shell).not.toHaveClass('bg-rose-50/70');
      expect(within(shell).queryByRole('button', {name:messages.deviceReconnect})).toBeNull();
    }
    expect(shell).toHaveTextContent(messages.devicePermissionDenied.replace('{resource}', messages.deviceResource_inputMicrophone));
  });
  it(`${locale}: each denied Reconnect calls actual getUserMedia; pending coalesces; success stays idle`, async () => {
    const track = Object.assign(new EventTarget(), { readyState:'live', muted:false, stop:vi.fn() });
    const root = { getTracks:()=>[track], getAudioTracks:()=>[track] } as unknown as MediaStream;
    let rejectSecond!: (e:Error)=>void;
    const getUserMedia = vi.fn().mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError'))
      .mockImplementationOnce(()=>new Promise<MediaStream>((_,reject)=>{rejectSecond=reject;})).mockResolvedValueOnce(root);
    vi.stubGlobal('navigator', { userAgent:navigator.userAgent, maxTouchPoints:0, mediaDevices:{getUserMedia} });
    function DeviceStatus() {
      const device = usePracticeDeviceLease({mode:'STEP_BY_STEP', inputSource:'MICROPHONE', recordingMode:'OFF'}, true);
      return <PracticeStatus lifecycle="IDLE" sessionMode="STEP_BY_STEP" deviceIssue={device.snapshot?.issue}
        deviceControls={<PracticeDeviceStatusPopover resource="inputMicrophone" health={device.snapshot?.health.inputMicrophone ?? null}
          issue={device.snapshot?.issue ?? null} canReconnect={device.snapshot?.state==='FAULTED'} onReconnect={async()=>{await device.renewFailed();}} />} />;
    }
    render(<NextIntlClientProvider locale={locale} messages={{practice:messages}}><DeviceStatus /></NextIntlClientProvider>);
    const unavailable = messages.deviceStatusUnavailable.replace('{resource}',messages.deviceResource_inputMicrophone);
    const permissionCopy = messages.devicePermissionDenied.replace('{resource}',messages.deviceResource_inputMicrophone);
    await waitFor(()=>expect(screen.getByTestId('practice-status')).toHaveTextContent(permissionCopy));
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button',{name:unavailable}));
    const button = screen.getByRole('button',{name:messages.deviceReconnect}); fireEvent.click(button); fireEvent.click(button);
    await waitFor(()=>expect(getUserMedia).toHaveBeenCalledTimes(2)); expect(button).toBeDisabled(); expect(button).toHaveAttribute('aria-busy','true');
    await act(async()=>{rejectSecond(new DOMException('still blocked','NotAllowedError'));});
    expect(screen.getByRole('button',{name:messages.deviceReconnect})).toBeEnabled();
    expect(screen.getByRole('dialog')).toHaveTextContent(permissionCopy);
    expect(within(screen.getByRole('dialog')).getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button',{name:messages.deviceReconnect}));
    await waitFor(()=>expect(screen.getByRole('button',{name:messages.deviceStatusReady.replace('{resource}',messages.deviceResource_inputMicrophone)})).toHaveClass('text-emerald-600'));
    expect(getUserMedia).toHaveBeenCalledTimes(3); expect(screen.getByTestId('practice-status')).not.toHaveTextContent(permissionCopy);
    expect(screen.getByTestId('practice-status')).not.toHaveTextContent(messages.stepMicrophoneReady);
    expect(screen.queryByRole('button',{name:messages.deviceReconnect})).toBeNull(); expect(track.stop).not.toHaveBeenCalled();
  });
}
it('blocking attempt ownership hides recovery even if its physical root is lost', () => {
  render(<NextIntlClientProvider locale="en" messages={{practice:en}}>
    <PracticeDeviceStatusPopover resource="inputMicrophone" health="LOST" issue={{resource:'inputMicrophone',phase:'RUNTIME',condition:'LOST'}} canReconnect={false} onReconnect={async()=>{throw Error('must not acquire');}} />
  </NextIntlClientProvider>);
  fireEvent.click(screen.getByRole('button',{name:'Microphone unavailable'}));
  expect(screen.getByRole('dialog')).toHaveTextContent('Microphone disconnected.'); expect(within(screen.getByRole('dialog')).queryAllByRole('button')).toHaveLength(0);
});
it('normal Continuous with accessories stays prose-free', () => {
  render(<NextIntlClientProvider locale="en" messages={{practice:en}}><PracticeStatus lifecycle="ACTIVE" sessionMode="CONTINUOUS_PLAY"
    deviceControls={<PracticeDeviceStatusPopover resource="inputMicrophone" health="HEALTHY" issue={null} canReconnect={false} onReconnect={async()=>{}} />} /></NextIntlClientProvider>);
  expect(screen.getByTestId('practice-status')).toHaveTextContent(/^$/); expect(screen.getByRole('button',{name:'Microphone ready'})).toBeVisible();
});

it('MIDI loss keeps a status/reconnect control and explicitly reacquires MIDIAccess', async () => {
  const first = midiDeviceFixture(), next = midiDeviceFixture();
  const requestMIDIAccess = vi.fn().mockResolvedValueOnce(first.access).mockResolvedValueOnce(next.access);
  vi.stubGlobal('navigator', { userAgent: navigator.userAgent, maxTouchPoints: 0, requestMIDIAccess });
  function Status() {
    const device = usePracticeDeviceLease({ mode: 'STEP_BY_STEP', inputSource: 'MIDI', recordingMode: 'OFF' }, true);
    return <PracticeStatus lifecycle="IDLE" sessionMode="STEP_BY_STEP" deviceIssue={device.snapshot?.issue} deviceControls={
      <PracticeDeviceStatusPopover resource="midi" health={device.snapshot?.health.midi ?? null} issue={device.snapshot?.issue ?? null}
        canReconnect={device.snapshot?.state === 'FAULTED'} onReconnect={async () => { await device.renewFailed(); }} />
    } />;
  }
  render(<NextIntlClientProvider locale="en" messages={{ practice: en }}><Status /></NextIntlClientProvider>);
  await waitFor(() => expect(screen.getByRole('button', { name: 'MIDI keyboard ready' })).toBeInTheDocument());
  const shell = screen.getByTestId('practice-status');
  act(() => first.connect(false));
  expect(shell).toHaveTextContent('MIDI keyboard disconnected.');
  fireEvent.click(screen.getByRole('button', { name: 'MIDI keyboard unavailable' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'MIDI keyboard ready' })).toBeInTheDocument());
  expect(requestMIDIAccess).toHaveBeenCalledTimes(2); expect(screen.getByTestId('practice-status')).toBe(shell);
  expect(shell).toHaveTextContent(''); expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
});
it('camera loss reconnects only the camera while preserving the healthy microphone root', async () => {
  const root = (kind: string) => {
    const track = Object.assign(new EventTarget(), { kind, readyState: 'live', muted: false, stop: vi.fn() });
    const stream = { getTracks: () => [track], getAudioTracks: () => kind === 'audio' ? [track] : [], getVideoTracks: () => kind === 'video' ? [track] : [] } as unknown as MediaStream;
    return { track, stream };
  };
  const mic = root('audio'), camera = root('video'), replacement = root('video');
  const getUserMedia = vi.fn().mockResolvedValueOnce(mic.stream).mockResolvedValueOnce(camera.stream).mockResolvedValueOnce(replacement.stream);
  vi.stubGlobal('navigator', { userAgent: navigator.userAgent, maxTouchPoints: 0, mediaDevices: { getUserMedia } });
  function Status() {
    const device = usePracticeDeviceLease({ mode: 'CONTINUOUS_PLAY', inputSource: 'MICROPHONE', recordingMode: 'VIDEO' }, true);
    return <PracticeStatus lifecycle="IDLE" sessionMode="CONTINUOUS_PLAY" deviceIssue={device.snapshot?.issue} deviceControls={
      <PracticeDeviceStatusPopover resource="camera" health={device.snapshot?.health.camera ?? null} issue={device.snapshot?.issue ?? null}
        canReconnect={device.snapshot?.state === 'FAULTED'} onReconnect={async () => { await device.renewFailed(); }} />
    } />;
  }
  render(<NextIntlClientProvider locale="en" messages={{ practice: en }}><Status /></NextIntlClientProvider>);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Camera ready' })).toBeInTheDocument());
  act(() => { camera.track.readyState = 'ended'; camera.track.dispatchEvent(new Event('ended')); });
  expect(screen.getByTestId('practice-status')).toHaveTextContent('Camera disconnected.');
  fireEvent.click(screen.getByRole('button', { name: 'Camera unavailable' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Camera ready' })).toBeInTheDocument());
  expect(getUserMedia).toHaveBeenCalledTimes(3); expect(getUserMedia.mock.calls[2][0]).toMatchObject({ audio: false, video: expect.anything() });
  expect(mic.track.stop).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
});
