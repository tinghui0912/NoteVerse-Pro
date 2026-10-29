// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup, act } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { expect, it, vi } from 'vitest';
import messages from '../../../messages/en/practice.json';
import zh from '../../../messages/zh/practice.json';
import type { PracticeResourceIntervention } from '@/lib/practice/continuous/resource-intervention';
import { ResourceInterruptionDialog } from './resource-interruption-dialog';

for (const impact of ['RECORDING_ONLY', 'INPUT_REQUIRED', 'INPUT_AND_RECORDING'] as const) {
  for (const phase of ['WAITING', 'RECOVERED', 'HARD'] as const) it(`${impact} ${phase} exposes only safe explicit decisions`, async () => {
    const onContinue = vi.fn(), onContinueWithout = vi.fn(), onEnd = vi.fn(async () => {});
    const intervention = { impact, reason: 'AUDIO_TRACK_MUTED' as const, recoverability: phase === 'HARD' ? 'RESTART_REQUIRED' as const : 'SAME_PIPELINE_RECOVERABLE' as const,
      state: phase === 'RECOVERED' ? 'RECOVERED_WAITING_FOR_USER' as const : 'WAITING_FOR_USER' as const, pauseOrigin: 'INTERVENTION' as const };
    render(<NextIntlClientProvider locale="en" messages={{ practice: messages }}><ResourceInterruptionDialog
      {...{ intervention, onContinue, onContinueWithout, onEnd }} /></NextIntlClientProvider>);
    expect(screen.getByRole('alertdialog')).toBeVisible(); expect(screen.queryByRole('button', { name: /Restart|重新开始/ })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(phase === 'RECOVERED' || impact === 'RECORDING_ONLY' ? 2 : 1); expect(screen.queryByRole('button', { name: /check/i })).toBeNull();
    const resume = screen.queryByRole('button', { name: messages.resume });
    if (phase === 'RECOVERED') { fireEvent.click(resume!); expect(onContinue).toHaveBeenCalledOnce(); } else expect(resume).toBeNull();
    const degrade = screen.queryByRole('button', { name: messages.recordingContinueWithout });
    if (impact === 'RECORDING_ONLY' && phase !== 'RECOVERED') { fireEvent.click(degrade!); expect(onContinueWithout).toHaveBeenCalledOnce(); } else expect(degrade).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' }); expect(onEnd).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: messages.finish })); }); expect(onEnd).toHaveBeenCalledOnce(); cleanup();
  });
}

for (const [locale, copy] of [['en', messages], ['zh', zh]] as const) {
  for (const scenario of [
    { name: 'hard capture input', impact: 'INPUT_REQUIRED', reason: 'CAPTURE_PIPELINE_INVALID', hard: true, recovered: false,
      title: 'captureProcessingStopped', description: 'captureProcessingStoppedDescription' },
    { name: 'hard capture input and recording', impact: 'INPUT_AND_RECORDING', reason: 'CAPTURE_PIPELINE_INVALID', hard: true, recovered: false,
      title: 'captureProcessingStopped', description: 'captureProcessingStoppedDescription' },
    { name: 'physical input loss', impact: 'INPUT_REQUIRED', reason: 'MICROPHONE_SOURCE_LOST', hard: true, recovered: false,
      title: 'inputCannotContinue', description: 'inputRestartRequiredDescription' },
    { name: 'temporary clock interruption', impact: 'INPUT_REQUIRED', reason: 'AUDIO_CONTEXT_INTERRUPTED', hard: false, recovered: false,
      title: 'inputInterrupted', description: 'inputInterruptionDescription' },
    { name: 'recovered clock', impact: 'INPUT_REQUIRED', reason: 'AUDIO_CONTEXT_INTERRUPTED', hard: false, recovered: true,
      title: 'inputRecovered', description: 'inputInterruptionDescription' },
    { name: 'hard recording only', impact: 'RECORDING_ONLY', reason: 'MEDIA_RECORDER_ERROR', hard: true, recovered: false,
      title: 'recordingCannotContinue', description: 'recordingRestartRequiredDescription' },
    { name: 'recovered recording only', impact: 'RECORDING_ONLY', reason: 'AUDIO_TRACK_MUTED', hard: false, recovered: true,
      title: 'recordingRecovered', description: 'recordingInterruptedDescription' },
  ] as const) it(`${locale} ${scenario.name} has reason-accurate copy and safe actions`, async () => {
    const onEnd = vi.fn(async () => {}), onContinue = vi.fn(), onContinueWithout = vi.fn();
    const intervention: PracticeResourceIntervention = { impact: scenario.impact, reason: scenario.reason,
      recoverability: scenario.hard ? 'RESTART_REQUIRED' : 'SAME_PIPELINE_RECOVERABLE',
      state: scenario.recovered ? 'RECOVERED_WAITING_FOR_USER' : 'WAITING_FOR_USER', pauseOrigin: 'INTERVENTION' };
    render(<NextIntlClientProvider locale={locale} messages={{ practice: copy }}><ResourceInterruptionDialog
      {...{ intervention, onEnd, onContinue, onContinueWithout }} /></NextIntlClientProvider>);
    expect(screen.getByRole('alertdialog')).toHaveAccessibleName(copy[scenario.title]);
    expect(screen.getByText(copy[scenario.description])).toBeVisible();
    const actions = [copy.finish];
    if (scenario.recovered) actions.unshift(copy.resume);
    else if (scenario.impact === 'RECORDING_ONLY') actions.unshift(copy.recordingContinueWithout);
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(actions);
    if (scenario.reason === 'CAPTURE_PIPELINE_INVALID') {
      expect(screen.getByRole('alertdialog').textContent).not.toMatch(/disconnected|已断开|CAPTURE_BOUNDARY_LIMIT_EXCEEDED/);
      expect(screen.getAllByRole('button')).toHaveLength(1);
    }
    expect(screen.queryByRole('button', { name: /Restart|Retry|重新开始|重试/ })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' }); fireEvent.pointerDown(document.body);
    expect(screen.getByRole('alertdialog')).toBeVisible(); expect(onEnd).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: copy.finish })); });
    expect(onEnd).toHaveBeenCalledOnce(); expect(onContinue).not.toHaveBeenCalled(); expect(onContinueWithout).not.toHaveBeenCalled(); cleanup();
  });
}
