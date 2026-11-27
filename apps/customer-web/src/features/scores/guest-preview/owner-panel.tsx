'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useGuestPreviewSettings,
  useIssueGuestPreviewCredential,
  useRevokeGuestPreviewCredential,
  useRotateGuestPreviewCredential,
} from '@/features/scores/guest-preview/queries';
import { guestPreviewLocation } from './routes';
import { userFacingErrorMessage } from '@/lib/i18n/error-message';

export function ScoreGuestPreviewPanel({ scoreId }: { scoreId: string }) {
  const t = useTranslations('guestPreview');
  const errors = useTranslations('errors');
  const locale = useLocale();
  const [feedback, setFeedback] = useState('');
  const settings = useGuestPreviewSettings(scoreId);
  const issue = useIssueGuestPreviewCredential(scoreId);
  const revoke = useRevokeGuestPreviewCredential(scoreId);
  const rotate = useRotateGuestPreviewCredential(scoreId);
  const [revealed, setRevealed] = useState<{ scoreId: string; token: string } | null>(null);
  const revealedToken = revealed?.scoreId === scoreId ? revealed.token : null;
  const pending = issue.isPending || revoke.isPending || rotate.isPending;
  const data = settings.data;
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const link = data?.enabled && revealedToken
    ? `${origin}${guestPreviewLocation(revealedToken, locale)}`
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
          {data.enabled ? (
            <>
              {!revealedToken ? <p>{t('secretHidden')}</p> : null}
              <p className="text-sm text-muted-foreground">{t('rotateWarning')}</p>
              <Button disabled={pending} onClick={() => rotate.mutate(undefined, {
                onSuccess: ({ token }) => { setRevealed({ scoreId, token }); setFeedback(''); rotate.reset(); },
                onError: showError,
              })}>{t('rotate')}</Button>
              <Button disabled={pending} onClick={() => revoke.mutate(undefined, {
                onSuccess: () => { setRevealed(null); setFeedback(''); issue.reset(); rotate.reset(); },
                onError: showError,
              })}>{t('disable')}</Button>
            </>
          ) : (
            <Button disabled={pending} onClick={() => issue.mutate(undefined, {
              onSuccess: ({ token }) => { setRevealed({ scoreId, token }); setFeedback(''); issue.reset(); },
              onError: showError,
            })}>{t('enable')}</Button>
          )}
          {link ? (
            <div className="space-y-2">
              <p>{t('newLink')}</p>
              <p className="text-sm text-muted-foreground">{t('oneTimeReveal')}</p>
              <div className="flex gap-2">
                <Input aria-label={t('link')} readOnly value={link} />
                <Button onClick={() => {
                  void navigator.clipboard.writeText(link)
                    .then(() => setFeedback(t('copied'))).catch(showError);
                }}>{t('copy')}</Button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
      {feedback ? <p role="status">{feedback}</p> : null}
    </div>
  );
}
