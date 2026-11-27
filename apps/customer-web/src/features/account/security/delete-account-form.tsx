'use client';

import { useQueryClient } from '@tanstack/react-query';
import { accountResourcesDeleted } from '../cache';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { accountSecurityApi } from './api';
import { useAuthentication } from '@/features/authentication/session/authentication-context';
import { useRouter } from '@/i18n/routing';
import { userFacingErrorMessage } from '@/lib/i18n/error-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function DeleteAccountForm() {
  const client = useQueryClient();
  const t = useTranslations('settings.deletion');
  const errors = useTranslations('errors');
  const { clearPrincipal } = useAuthentication();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!confirmed || !password || pending) return;
    setPending(true); setError(undefined);
    try {
      await accountSecurityApi.deleteAccount(password);
      void accountResourcesDeleted(client);
      clearPrincipal();
      router.replace('/');
    } catch (cause) {
      setError(userFacingErrorMessage(errors, cause));
      setPending(false);
    }
  }

  return <form onSubmit={submit} className="mt-8 space-y-4 border-t border-red-200 pt-6">
    <h3 className="font-semibold text-red-700">{t('title')}</h3>
    <p className="text-sm text-gray-600">{t('description')}</p>
    <p className="text-sm text-gray-600">{t('retention')}</p>
    <Label htmlFor="delete-account-password">{t('password')}</Label>
    <Input id="delete-account-password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} disabled={pending} />
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={pending} />{t('confirm')}</label>
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    <Button type="submit" variant="destructive" disabled={pending || !confirmed || !password}>{t(pending ? 'pending' : 'submit')}</Button>
  </form>;
}
