'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { RecordingIntervention } from '@/lib/practice/continuous/recording-intervention';

export function RecordingInterruptionDialog({ intervention, onContinueWithout, onCheck, onRestart, onEnd }: {
  intervention: RecordingIntervention | null; onContinueWithout(): void; onCheck(): boolean;
  onRestart(): Promise<void>; onEnd(): void;
}) {
  const t = useTranslations('practice'), [checkingFailed, setCheckingFailed] = useState(false), [busy, setBusy] = useState(false);
  const hard = intervention?.recoverability === 'RESTART_REQUIRED';
  return <AlertDialog open={intervention !== null}>
    <AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>{t(hard ? 'recordingCannotContinue' : 'recordingInterrupted')}</AlertDialogTitle>
        <AlertDialogDescription>{t(hard ? 'recordingRestartRequiredDescription' : 'recordingInterruptedDescription')}</AlertDialogDescription></AlertDialogHeader>
      {checkingFailed && <p role="status" className="text-sm text-slate-600">{t('recordingRecoveryNotReady')}</p>}
      <AlertDialogFooter className="flex-wrap gap-2">
        {!hard && <Button disabled={busy} variant="outline" onClick={() => setCheckingFailed(!onCheck())}>{t('recordingCheckAndContinue')}</Button>}
        <Button disabled={busy} onClick={onContinueWithout}>{t('recordingContinueWithout')}</Button>
        <Button disabled={busy} variant="outline" onClick={() => { setBusy(true); void onRestart().finally(() => setBusy(false)); }}>{t('recordingRestart')}</Button>
        <Button disabled={busy} variant="destructive" onClick={onEnd}>{t('finish')}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
