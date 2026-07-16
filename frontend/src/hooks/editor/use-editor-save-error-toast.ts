'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useToast } from '@/hooks/use-toast';
import { userFacingErrorMessage } from '@/lib/i18n/error-message';
import { reportUnexpectedClientError } from '@/lib/observability';

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
    reportUnexpectedClientError(error, {
      area: 'editor',
      action: titleNamespace === 'review' ? 'save_review_document' : 'save_score_document',
    });
    toast({
      title: titleNamespace === 'review' ? review('saveFailed') : editor('saveFailed'),
      description: userFacingErrorMessage(errors, error, editor('saveFailedDesc')),
      variant: 'destructive',
    });
  }, [editor, errors, review, titleNamespace, toast]);
}
