'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

export function useBackendMessage() {
  const t = useTranslations('backend');

  return useCallback((code: string): string => {
    try {
      return t(code as never);
    } catch {
      return code;
    }
  }, [t]);
}
