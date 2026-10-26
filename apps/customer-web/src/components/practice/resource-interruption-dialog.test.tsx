// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { expect, it, vi } from 'vitest';
import messages from '../../../messages/en/practice.json';
import { ResourceInterruptionDialog } from './resource-interruption-dialog';

for (const impact of ['RECORDING_ONLY', 'INPUT_REQUIRED', 'INPUT_AND_RECORDING'] as const) {
  for (const phase of ['WAITING', 'RECOVERED', 'HARD'] as const) it(`${impact} ${phase} exposes only safe explicit decisions`, () => {
    const onContinue = vi.fn(), onContinueWithout = vi.fn(), onRestart = vi.fn(async () => {}), onEnd = vi.fn();
    const intervention = { impact, reason: 'AUDIO_TRACK_MUTED' as const, recoverability: phase === 'HARD' ? 'RESTART_REQUIRED' as const : 'SAME_PIPELINE_RECOVERABLE' as const,
      state: phase === 'RECOVERED' ? 'RECOVERED_WAITING_FOR_USER' as const : 'WAITING_FOR_USER' as const, pauseOrigin: 'INTERVENTION' as const };
    render(<NextIntlClientProvider locale="en" messages={{ practice: messages }}><ResourceInterruptionDialog
      {...{ intervention, onContinue, onContinueWithout, onRestart, onEnd }} /></NextIntlClientProvider>);
    expect(screen.getByRole('alertdialog')).toBeVisible(); expect(screen.queryByRole('button', { name: /check/i })).toBeNull();
    const resume = screen.queryByRole('button', { name: messages.resume });
    if (phase === 'RECOVERED') { fireEvent.click(resume!); expect(onContinue).toHaveBeenCalledOnce(); } else expect(resume).toBeNull();
    const degrade = screen.queryByRole('button', { name: messages.recordingContinueWithout });
    if (impact === 'RECORDING_ONLY') { fireEvent.click(degrade!); expect(onContinueWithout).toHaveBeenCalledOnce(); } else expect(degrade).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' }); expect(onEnd).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: messages.finish })); expect(onEnd).toHaveBeenCalledOnce(); cleanup();
  });
}
