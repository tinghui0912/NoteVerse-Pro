'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useToast } from '@/hooks/use-toast';
import { ApiError } from '@/lib/api-client';

export function useEditorSaveErrorToast({
  titleNamespace = 'editor',
}: {
  titleNamespace?: 'editor' | 'review';
} = {}) {
  const editor = useTranslations('editor');
  const review = useTranslations('review');
  const { toast } = useToast();

  return useCallback((error: unknown) => {
    toast({
      title: titleNamespace === 'review' ? review('saveFailed') : editor('saveFailed'),
      description: error instanceof ApiError ? error.message : editor('saveFailedDesc'),
      variant: 'destructive',
    });
  }, [editor, review, titleNamespace, toast]);
}
