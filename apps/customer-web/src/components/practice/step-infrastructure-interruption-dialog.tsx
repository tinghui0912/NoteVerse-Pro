'use client';
import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

/** A failed STEP input cannot recover within the retained attempt. */
export function StepInfrastructureInterruptionDialog({ onEnd }: { onEnd(): Promise<void> }) {
  const t = useTranslations('practice'), [busy, setBusy] = useState(false), ending = useRef(false);
  const end = async () => {
    if (ending.current) return;
    ending.current = true; setBusy(true);
    try { await onEnd(); } finally { ending.current = false; setBusy(false); }
  };
  return <AlertDialog open>
    <AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>{t('stepInfrastructureStopped')}</AlertDialogTitle>
        <AlertDialogDescription>{t('stepInfrastructureStoppedDescription')}</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><Button disabled={busy} variant="destructive" onClick={() => { void end(); }}>{t('finish')}</Button></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
