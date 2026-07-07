'use client';

import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ScoreValidationIssue } from '@/lib/musicxml/validator';

interface ReviewValidationWarningsProps {
  warnings: ScoreValidationIssue[];
}

export function ReviewValidationWarnings({ warnings }: ReviewValidationWarningsProps) {
  const t = useTranslations('review');
  const focusIssue = (issue: ScoreValidationIssue) => {
    if (issue.measureIndex === undefined) return;
    document.getElementById(`score-measure-warning-${issue.measureIndex}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  };

  if (warnings.length === 0) return null;

  return (
    <Card className="mb-8 rounded-2xl border-yellow-500/30 bg-yellow-50 shadow-lg">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-yellow-800">
          <AlertTriangle className="h-5 w-5" />
          {t('attentionTitle', { count: warnings.length })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-yellow-800/80">{t('attentionDescription')}</p>
        <ul className="max-h-44 space-y-2 overflow-y-auto pr-2 text-sm custom-scrollbar">
          {warnings.map((warning, index) => (
            <li key={`${warning.code}-${index}`} className="border-l-2 border-yellow-500/40 pl-3 text-yellow-900">
              {warning.measureIndex === undefined ? warning.message : (
                <button type="button" className="text-left hover:underline" onClick={() => focusIssue(warning)}>
                  {warning.message}
                </button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
