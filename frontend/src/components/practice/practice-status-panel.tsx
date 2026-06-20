'use client';

import { Mic } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { PracticeStatus } from '@/lib/practice/practice-types';

interface PracticeStatusPanelProps {
  status: PracticeStatus;
  hasMicPermission: boolean | null;
  audioWorkletSupported: boolean;
}

export function PracticeStatusPanel({
  status,
  hasMicPermission,
  audioWorkletSupported,
}: PracticeStatusPanelProps) {
  const t = useTranslations('practice');
  if (status !== 'idle') {
    return null;
  }

  return (
    <>
      {hasMicPermission === false && (
        <Alert variant="destructive">
          <Mic className="h-4 w-4" />
          <AlertTitle>{t('micAccessDeniedAlertTitle')}</AlertTitle>
          <AlertDescription>{t('micAccessDeniedAlertDesc')}</AlertDescription>
        </Alert>
      )}
      {!audioWorkletSupported && (
        <Alert variant="destructive">
          <Mic className="h-4 w-4" />
          <AlertTitle>{t('audioWorkletUnsupportedAlertTitle')}</AlertTitle>
          <AlertDescription>{t('audioWorkletUnsupportedAlertDesc')}</AlertDescription>
        </Alert>
      )}
    </>
  );
}
