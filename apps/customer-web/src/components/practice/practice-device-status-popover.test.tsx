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
      it(`${locale} ${resource} ${condition}: read-only accessible device facts`, () => {
        const issue: PracticeDeviceIssue | null = condition === 'HEALTHY' ? null : { resource, phase: 'OPEN', condition };
        const health: PracticeDeviceHealth = condition === 'HEALTHY' ? 'HEALTHY' : condition === 'INTERRUPTED' ? 'INTERRUPTED' : 'LOST';
        const resourceLabel = messages[`deviceResource_${resource}`];
        const label = (condition === 'HEALTHY' ? messages.deviceStatusReady : messages.deviceStatusUnavailable).replace('{resource}', resourceLabel);
        const getUserMedia = vi.fn(), requestMIDIAccess = vi.fn();
        vi.stubGlobal('navigator', { mediaDevices: { getUserMedia }, requestMIDIAccess });
        render(<NextIntlClientProvider locale={locale} messages={{ practice: messages }}>
          <PracticeDeviceStatusPopover {...{resource, health, issue}} />
        </NextIntlClientProvider>);
        const trigger = screen.getByRole('button', { name: label });
        expect(trigger).toHaveClass(condition === 'HEALTHY' ? 'text-emerald-600' : 'text-rose-600');
        if (resource.includes('Microphone')) expect(trigger.querySelector('svg')).toHaveClass('lucide-mic');
        fireEvent.click(trigger);
        const popover = screen.getByRole('dialog', { name: resourceLabel });
        expect(within(popover).queryAllByRole('button')).toHaveLength(0);
        if (condition === 'PERMISSION_DENIED') expect(popover).toHaveTextContent(messages.devicePermissionDenied.replace('{resource}', resourceLabel));
        expect(getUserMedia).not.toHaveBeenCalled(); expect(requestMIDIAccess).not.toHaveBeenCalled();
      });
    }
  }
  it(`${locale}: healthy → lost → denied keeps the identical status shell`, () => {
    const status = (issue: PracticeDeviceIssue | null) => <NextIntlClientProvider locale={locale} messages={{practice:messages}}>
      <PracticeStatus lifecycle="ACTIVE" sessionMode="STEP_BY_STEP" inputSource="MICROPHONE" stepInteractionPhase="READY"
        deviceIssue={issue} deviceControls={<PracticeDeviceStatusPopover resource="inputMicrophone" health={issue ? 'LOST' : 'HEALTHY'} issue={issue} />} />
    </NextIntlClientProvider>;
    const view = render(status(null)), shell = screen.getByTestId('practice-status'), classes = shell.className;
    expect(shell).toHaveTextContent(messages.stepMicrophoneReady);
    for (const condition of ['LOST', 'PERMISSION_DENIED'] as const) {
      view.rerender(status({resource:'inputMicrophone', phase:'RUNTIME', condition}));
      expect(screen.getByTestId('practice-status')).toBe(shell); expect(shell.className).toBe(classes);
      expect(shell).not.toHaveTextContent(messages.stepMicrophoneReady); expect(shell).not.toHaveClass('bg-rose-50/70');
    }
  });
  it(`${locale}: repeated permission-denied icon visits never reacquire the execution root`, async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('blocked', 'NotAllowedError'));
    vi.stubGlobal('navigator', { userAgent: navigator.userAgent, maxTouchPoints: 0, mediaDevices: { getUserMedia } });
    function Status() {
      const device = usePracticeDeviceLease({ mode:'STEP_BY_STEP', inputSource:'MICROPHONE', recordingMode:'OFF' }, true);
      return <PracticeStatus lifecycle="IDLE" sessionMode="STEP_BY_STEP" deviceIssue={device.snapshot?.issue} deviceControls={
        <PracticeDeviceStatusPopover resource="inputMicrophone" health={device.snapshot?.health.inputMicrophone ?? null} issue={device.snapshot?.issue ?? null} />
      } />;
    }
    render(<NextIntlClientProvider locale={locale} messages={{ practice: messages }}><Status /></NextIntlClientProvider>);
    const label = messages.deviceStatusUnavailable.replace('{resource}', messages.deviceResource_inputMicrophone);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(within(screen.getByRole('dialog')).queryAllByRole('button')).toHaveLength(0);
      fireEvent.click(screen.getByRole('button', { name: label }));
    }
    expect(getUserMedia).toHaveBeenCalledOnce();
  });
}
it('existing MIDIAccess statechange recovers naturally without requesting new access', async () => {
  const midi = midiDeviceFixture(), requestMIDIAccess = vi.fn().mockResolvedValue(midi.access);
  vi.stubGlobal('navigator', { userAgent:navigator.userAgent, maxTouchPoints:0, requestMIDIAccess });
  function Status() {
    const device = usePracticeDeviceLease({mode:'STEP_BY_STEP', inputSource:'MIDI', recordingMode:'OFF'}, true);
    return <PracticeStatus lifecycle="IDLE" sessionMode="STEP_BY_STEP" deviceIssue={device.snapshot?.issue} deviceControls={
      <PracticeDeviceStatusPopover resource="midi" health={device.snapshot?.health.midi ?? null} issue={device.snapshot?.issue ?? null} />
    } />;
  }
  render(<NextIntlClientProvider locale="en" messages={{practice:en}}><Status /></NextIntlClientProvider>);
  await waitFor(() => expect(screen.getByRole('button', {name:'MIDI keyboard ready'})).toBeInTheDocument());
  act(() => midi.connect(false)); fireEvent.click(screen.getByRole('button', {name:'MIDI keyboard unavailable'}));
  expect(within(screen.getByRole('dialog')).queryAllByRole('button')).toHaveLength(0);
  act(() => midi.connect(true));
  expect(screen.getByRole('button', {name:'MIDI keyboard ready'})).toHaveClass('text-emerald-600');
  expect(requestMIDIAccess).toHaveBeenCalledOnce();
});
