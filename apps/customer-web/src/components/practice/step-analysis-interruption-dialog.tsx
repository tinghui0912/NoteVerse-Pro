'use client';
import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

/** STEP cannot continue without analysis. End is the only explicit session-ending choice. */
export function StepAnalysisInterruptionDialog({ onEnd }: { onEnd(): Promise<void> }) {
  const t = useTranslations('practice'), [busy, setBusy] = useState(false), ending = useRef(false);
  const end = async () => {
    if (ending.current) return;
    ending.current = true; setBusy(true);
    try { await onEnd(); } finally { ending.current = false; setBusy(false); }
  };
  return <AlertDialog open>
    <AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>{t('analysisStopped')}</AlertDialogTitle>
        <AlertDialogDescription>{t('stepAnalysisStoppedDescription')}</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><Button disabled={busy} variant="destructive" onClick={() => { void end(); }}>{t('finish')}</Button></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
