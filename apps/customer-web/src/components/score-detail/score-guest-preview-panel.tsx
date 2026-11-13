'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useGuestPreviewSettings,
  useUpdateGuestPreviewSettings,
} from '@/hooks/guest-preview/use-guest-preview';
import { routing } from '@/i18n/routing';
import { userFacingErrorMessage } from '@/lib/i18n/error-message';

export function ScoreGuestPreviewPanel({ scoreId }: { scoreId: string }) {
  const t = useTranslations('guestPreview');
  const errors = useTranslations('errors');
  const locale = useLocale();
  const [feedback, setFeedback] = useState('');
  const settings = useGuestPreviewSettings(scoreId);
  const update = useUpdateGuestPreviewSettings(scoreId);
  const data = settings.data?.data;
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const link = data
    ? `${origin}${locale === routing.defaultLocale ? '' : `/${locale}`}/preview/${data.token}`
    : '';
  const showError = (error: unknown) =>
    setFeedback(userFacingErrorMessage(errors, error, t('failed')));
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">{t('title')}</h2>
      <p>{t('description')}</p>
      <p className="text-sm text-muted-foreground">{t('limits')}</p>
      {settings.isLoading ? <p>{t('loading')}</p> : null}
      {settings.error ? <p role="alert">{t('failed')}</p> : null}
      {data ? (
        <>
          <p>{data.enabled ? t('enabled') : t('disabled')}</p>
          <Button
            disabled={update.isPending}
            onClick={() => update.mutate({ enabled: !data.enabled }, { onError: showError })}
          >
            {data.enabled ? t('disable') : t('enable')}
          </Button>
          <div className="flex gap-2">
            <Input aria-label={t('link')} readOnly value={link} />
            <Button
              onClick={() => {
                void navigator.clipboard
                  .writeText(link)
                  .then(() => setFeedback(t('copied')))
                  .catch(showError);
              }}
            >
              {t('copy')}
            </Button>
          </div>
        </>
      ) : null}
      {feedback ? <p role="status">{feedback}</p> : null}
    </div>
  );
}
