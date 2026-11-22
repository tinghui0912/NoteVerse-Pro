'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { AuthCard } from '@/components/auth/auth-card';
import { InlineLoading } from '@/components/loading';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { accountSecurityApi } from './api';
import { accountSecurityChanged } from '../cache';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/auth-context';
import { reportUnexpectedClientError } from '@/lib/observability';
import { ApiError } from '@/lib/http/customer-browser-transport';
import { translateErrorCode } from '@/lib/i18n/error-message';

type ConfirmState = 'confirming' | 'success' | 'error';

const confirmationRequests = new Map<string, Promise<void>>();

function confirmEmailChangeOnce(token: string) {
  const existingRequest = confirmationRequests.get(token);
  if (existingRequest) return existingRequest;

  const request = accountSecurityApi.confirmEmailChange(token).then(() => undefined).catch((error) => {
    confirmationRequests.delete(token);
    throw error;
  });
  confirmationRequests.set(token, request);
  return request;
}

export default function ConfirmEmailChangePage() {
  const client = useQueryClient();
  const { refreshUser, isLoading: principalLoading } = useAuth();
  const t = useTranslations('auth');
  const tErrors = useTranslations('errors');
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [state, setState] = useState<ConfirmState>(token ? 'confirming' : 'error');
  const [error, setError] = useState(token ? '' : t('emailChangeLinkInvalid'));

  useEffect(() => {
    // Finish bootstrap before the post-confirm refresh so an earlier profile read
    // cannot overwrite the newly confirmed identity.
    if (!token || principalLoading) return;

    let isMounted = true;
    confirmEmailChangeOnce(token)
      .then(async () => {
        if (!isMounted) return;
        // Confirmation is authoritative; projection refresh failures cannot undo it.
        const results = await Promise.allSettled([accountSecurityChanged(client), refreshUser()]);
        for (const result of results) {
          if (result.status === 'rejected') reportUnexpectedClientError(result.reason, {
            area: 'account', action: 'refresh_after_email_confirmation',
          });
        }
        if (isMounted) setState('success');
      }, (err) => {
        if (!isMounted) return;
        setState('error');
        if (err instanceof ApiError) {
          setError(
            err.code === 'token_invalid_expired'
              ? t('emailChangeLinkInvalid')
              : translateErrorCode(tErrors, err.code, t('emailChangeLinkInvalid'))
          );
        } else {
          setError(t('verifyFailedRetry'));
        }
      });

    return () => {
      isMounted = false;
    };
  }, [t, tErrors, token, client, refreshUser, principalLoading]);

  if (state === 'confirming') {
    return (
      <AuthCard title={t('confirmingEmailChangeTitle')} subtitle={t('confirmingEmailChangeSubtitle')}>
        <div className="flex justify-center py-6 text-orange-600">
          <InlineLoading />
        </div>
      </AuthCard>
    );
  }

  if (state === 'success') {
    return (
      <AuthCard title={t('emailChangeConfirmedTitle')} subtitle={t('emailChangeConfirmedSubtitle')}>
        <Button asChild size="lg" className="w-full bg-orange-500 font-semibold text-white hover:bg-orange-600">
          <Link href="/settings/security">{t('backToSecurity')}</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('emailChangeFailedTitle')} subtitle={error}>
      <Button asChild size="lg" className="w-full bg-orange-500 font-semibold text-white hover:bg-orange-600">
        <Link href="/settings/security">{t('backToSecurity')}</Link>
      </Button>
    </AuthCard>
  );
}
