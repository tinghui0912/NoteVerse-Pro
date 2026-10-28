'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

/** Blocking learner choice; no runtime/resource ownership or technical failure payload. */
export function AnalysisInterruptionDialog({ onContinueWithoutAnalysis, onRestart, onEnd }: {
  onContinueWithoutAnalysis(): Promise<void>; onRestart(): Promise<void>; onEnd(): void;
}) {
  const t = useTranslations('practice'), [busy, setBusy] = useState(false);
  const run = (action: () => Promise<void>) => { setBusy(true); void action().finally(() => setBusy(false)); };
  return <AlertDialog open>
    <AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>{t('analysisStopped')}</AlertDialogTitle>
        <AlertDialogDescription>{t('analysisStoppedDescription')}</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter className="flex-wrap gap-2">
        <Button disabled={busy} onClick={() => run(onContinueWithoutAnalysis)}>{t('continueWithoutAnalysis')}</Button>
        <Button disabled={busy} variant="outline" onClick={() => run(onRestart)}>{t('recordingRestart')}</Button>
        <Button disabled={busy} variant="destructive" onClick={onEnd}>{t('finish')}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
