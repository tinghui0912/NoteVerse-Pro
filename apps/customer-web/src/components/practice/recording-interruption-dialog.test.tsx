// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { expect, it, vi } from 'vitest';
import messages from '../../../messages/en/practice.json';
import { RecordingInterruptionDialog } from './recording-interruption-dialog';

for (const hard of [false, true]) it(`${hard ? 'hard' : 'recoverable'} interruption requires an explicit decision and exposes only safe choices`, () => {
  const onCheck = vi.fn(() => false), onContinueWithout = vi.fn(), onRestart = vi.fn(async () => {}), onEnd = vi.fn();
  render(<NextIntlClientProvider locale="en" messages={{ practice: messages }}><RecordingInterruptionDialog
    intervention={{ reason: hard ? 'AUDIO_TRACK_ENDED' : 'AUDIO_TRACK_MUTED', recoverability: hard ? 'RESTART_REQUIRED' : 'SAME_PIPELINE_RECOVERABLE', state: 'WAITING_FOR_USER', pauseOrigin: 'RECORDING' }}
    {...{ onCheck, onContinueWithout, onRestart, onEnd }} /></NextIntlClientProvider>);
  expect(screen.getByRole('alertdialog')).toBeVisible();
  expect(onContinueWithout).not.toHaveBeenCalled(); expect(onRestart).not.toHaveBeenCalled();
  const check = screen.queryByRole('button', { name: messages.recordingCheckAndContinue });
  if (hard) expect(check).toBeNull();
  else { fireEvent.click(check!); expect(onCheck).toHaveBeenCalledOnce(); expect(screen.getByRole('status')).toHaveTextContent(messages.recordingRecoveryNotReady); }
  fireEvent.click(screen.getByRole('button', { name: messages.recordingContinueWithout })); expect(onContinueWithout).toHaveBeenCalledOnce();
  fireEvent.keyDown(document, { key: 'Escape' }); expect(onEnd).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: messages.finish })); expect(onEnd).toHaveBeenCalledOnce();
});
