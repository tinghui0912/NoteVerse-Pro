'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useToast } from '@/hooks/use-toast';
import { userFacingErrorMessage } from '@/lib/i18n/error-message';

export function useEditorSaveErrorToast({
  titleNamespace = 'editor',
}: {
  titleNamespace?: 'editor' | 'review';
} = {}) {
  const editor = useTranslations('editor');
  const review = useTranslations('review');
  const errors = useTranslations('errors');
  const { toast } = useToast();

  return useCallback((error: unknown) => {
    toast({
      title: titleNamespace === 'review' ? review('saveFailed') : editor('saveFailed'),
      description: userFacingErrorMessage(errors, error, editor('saveFailedDesc')),
      variant: 'destructive',
    });
  }, [editor, errors, review, titleNamespace, toast]);
}
