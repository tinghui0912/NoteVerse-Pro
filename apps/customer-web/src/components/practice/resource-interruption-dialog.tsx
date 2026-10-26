'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { PracticeResourceIntervention } from '@/lib/practice/continuous/resource-intervention';

export function ResourceInterruptionDialog({ intervention, onContinueWithout, onContinue, onRestart, onEnd }: {
  intervention: PracticeResourceIntervention; onContinueWithout(): void; onContinue(): void;
  onRestart(): Promise<void>; onEnd(): void;
}) {
  const t = useTranslations('practice'), [busy, setBusy] = useState(false);
  const inputRequired = intervention.impact !== 'RECORDING_ONLY';
  const hard = intervention.recoverability === 'RESTART_REQUIRED';
  const recovered = intervention.state === 'RECOVERED_WAITING_FOR_USER';
  const title = inputRequired ? hard ? 'inputCannotContinue' : recovered ? 'inputRecovered' : 'inputInterrupted'
    : hard ? 'recordingCannotContinue' : recovered ? 'recordingRecovered' : 'recordingInterrupted';
  return <AlertDialog open>
    <AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>{t(title)}</AlertDialogTitle>
        <AlertDialogDescription>{t(inputRequired ? hard ? 'inputRestartRequiredDescription' : 'inputInterruptionDescription'
          : hard ? 'recordingRestartRequiredDescription' : 'recordingInterruptedDescription')}</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter className="flex-wrap gap-2">
        {recovered && !hard && <Button disabled={busy} onClick={onContinue}>{t('resume')}</Button>}
        {!inputRequired && <Button disabled={busy} variant="outline" onClick={onContinueWithout}>{t('recordingContinueWithout')}</Button>}
        <Button disabled={busy} variant="outline" onClick={() => { setBusy(true); void onRestart().finally(() => setBusy(false)); }}>{t('recordingRestart')}</Button>
        <Button disabled={busy} variant="destructive" onClick={onEnd}>{t('finish')}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
