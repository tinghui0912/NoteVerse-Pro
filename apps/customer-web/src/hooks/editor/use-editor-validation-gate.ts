'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useScoreData } from '@/contexts/editor-provider';
import { validateDataIntegrity, type ValidationResult } from '@/lib/musicxml/validator';

export function useEditorValidationGate(performSave: () => void) {
  const t = useTranslations('editor');
  const common = useTranslations('common');
  const auth = useTranslations('auth');
  const { scoreData, currentXml } = useScoreData();
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [validationDialogOpen, setValidationDialogOpen] = useState(false);

  const translateValidationKey = (key: string) => {
    if (!key.includes('.')) return t(key as never);
    const [namespace, ...rest] = key.split('.');
    const nestedKey = rest.join('.');
    if (namespace === 'editor') return t(nestedKey as never);
    if (namespace === 'common') return common(nestedKey as never);
    if (namespace === 'validation' || namespace === 'auth') return auth(`validation.${nestedKey}` as never);
    return key;
  };

  const save = () => {
    const result = validateDataIntegrity(scoreData, currentXml, translateValidationKey);
    if (!result.success || result.warnings.length > 0) {
      setValidationResult(result);
      setValidationDialogOpen(true);
      return;
    }
    performSave();
  };

  const saveIgnoringWarnings = () => {
    setValidationDialogOpen(false);
    setValidationResult(null);
    performSave();
  };

  return {
    save,
    saveIgnoringWarnings,
    setValidationDialogOpen,
    validationDialogOpen,
    validationResult,
  };
}
