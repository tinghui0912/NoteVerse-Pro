'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';

export function useEditorSaveCompletion({
  applyXml,
}: {
  applyXml?: (xml: string, options?: { resetHistory?: boolean; updateRawXml?: boolean }) => Promise<string>;
}) {
  const router = useRouter();
  const common = useTranslations('common');
  const { toast } = useToast();

  return useCallback(async ({
    xml,
    beforeNavigate,
    returnUrl,
  }: {
    xml?: string | null;
    beforeNavigate?: () => Promise<void> | void;
    returnUrl: string;
  }) => {
    if (xml && applyXml) {
      await applyXml(xml, { resetHistory: true, updateRawXml: true });
    }
    await beforeNavigate?.();
    toast({ title: common('savingSuccess'), description: common('scoreSaved') });
    router.push(returnUrl);
  }, [applyXml, common, router, toast]);
}
