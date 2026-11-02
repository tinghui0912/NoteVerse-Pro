'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateGuestPreview, useDeleteGuestPreview, useGuestPreviews, useRevokeGuestPreview } from '@/hooks/guest-preview/use-guest-preview';
import { routing } from '@/i18n/routing';
import { formatApiDateTime } from '@/lib/date-time';
import { userFacingErrorMessage } from '@/lib/i18n/error-message';

export function ScoreGuestPreviewPanel({ scoreId }: { scoreId: string }) {
  const t = useTranslations('guestPreview');
  const errors = useTranslations('errors');
  const locale = useLocale();
  const [expiration, setExpiration] = useState('7');
  const [customDate, setCustomDate] = useState('');
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const previews = useGuestPreviews(scoreId);
  const create = useCreateGuestPreview(scoreId);
  const revoke = useRevokeGuestPreview(scoreId);
  const remove = useDeleteGuestPreview(scoreId);
  const link = createdToken ? `${window.location.origin}${locale === routing.defaultLocale ? '' : `/${locale}`}/preview/${createdToken}` : '';
  const showError = (error: unknown) => setFeedback(userFacingErrorMessage(errors, error, t('failed')));
  const submit = () => {
    const now = Date.now();
    const expiry = expiration === 'custom' ? new Date(customDate).getTime() : now + Number(expiration) * 86_400_000;
    if (!Number.isFinite(expiry) || expiry <= now || expiry > now + 30 * 86_400_000) { setFeedback(t('invalidExpiration')); return; }
    create.mutate({ expires_at: new Date(expiry).toISOString() }, { onSuccess: ({ data }) => { if (data) setCreatedToken(data.token); setFeedback(''); }, onError: showError });
  };
  return <div className="space-y-4">
    <h2 className="text-xl font-semibold">{t('title')}</h2>
    <p>{t('description')}</p>
    <p className="text-sm text-muted-foreground">{t('limits')}</p>
    <Label htmlFor="preview-expiration">{t('expiration')}</Label>
    <select id="preview-expiration" value={expiration} onChange={(e) => setExpiration(e.target.value)} className="rounded border p-2">
      <option value="1">{t('oneDay')}</option><option value="7">{t('sevenDays')}</option><option value="30">{t('thirtyDays')}</option><option value="custom">{t('custom')}</option>
    </select>
    {expiration === 'custom' ? <Input type="datetime-local" aria-label={t('custom')} value={customDate} onChange={(e) => setCustomDate(e.target.value)} /> : null}
    <Button onClick={submit} disabled={create.isPending}>{t('create')}</Button>
    {link ? <div className="flex gap-2"><Input aria-label={t('link')} readOnly value={link} /><Button onClick={() => { void navigator.clipboard.writeText(link).then(() => setFeedback(t('copied'))).catch(showError); }}>{t('copy')}</Button></div> : null}
    {feedback ? <p role="status">{feedback}</p> : null}
    <h3 className="font-semibold">{t('existing')}</h3>
    {previews.error ? <p role="alert">{t('failed')}</p> : null}
    {(previews.data?.data ?? []).map((preview) => <div key={preview.preview_id} className="flex flex-wrap items-center gap-3 rounded border p-3">
      <span>{t('expiresAt', { date: formatApiDateTime(preview.expires_at, locale) })}</span>
      {preview.revoked_at ? <span>{t('revoked')}</span> : <Button variant="outline" disabled={revoke.isPending} onClick={() => revoke.mutate(preview.preview_id, { onError: showError })}>{t('revoke')}</Button>}
      <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate(preview.preview_id, { onError: showError })}>{t('delete')}</Button>
    </div>)}
  </div>;
}
