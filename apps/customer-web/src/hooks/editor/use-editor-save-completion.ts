'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';

export function useEditorSaveCompletion() {
  const router = useRouter();
  const common = useTranslations('common');
  const { toast } = useToast();

  return useCallback(async ({
    beforeNavigate,
    returnUrl,
  }: {
    beforeNavigate?: () => Promise<void> | void;
    returnUrl: string;
  }) => {
    await beforeNavigate?.();
    toast({ title: common('savingSuccess'), description: common('scoreSaved') });
    router.push(returnUrl);
  }, [common, router, toast]);
}
