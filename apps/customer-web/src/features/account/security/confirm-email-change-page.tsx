'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useFragmentToken } from '@/features/authentication/fragment-token';

import { AuthCard } from '@/components/auth/auth-card';
import { InlineLoading } from '@/components/loading';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { accountSecurityApi } from './api';
import { accountSecurityChanged } from '../cache';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthentication } from '@/features/authentication/session/authentication-context';
import { reportUnexpectedClientError } from '@/lib/observability';
import { ApiError } from '@/lib/http/customer-browser-transport';
import { translateErrorCode } from '@/lib/i18n/error-message';

type ConfirmState = 'confirming' | 'success' | 'error';

export default function ConfirmEmailChangePage() {
  const client = useQueryClient();
  const { refreshPrincipal, isLoading: principalLoading } = useAuthentication();
  const t = useTranslations('auth');
  const tErrors = useTranslations('errors');
  const token = useFragmentToken();
  const request = useRef<Promise<unknown> | null>(null);
  const [state, setState] = useState<ConfirmState>('confirming');
  const [error, setError] = useState('');

  useEffect(() => {
    // Finish bootstrap before the post-confirm refresh so an earlier profile read
    // cannot overwrite the newly confirmed identity.
    if (!token || principalLoading) return;

    let isMounted = true;
    request.current ??= accountSecurityApi.confirmEmailChange(token);
    request.current
      .then(async () => {
        if (!isMounted) return;
        // Confirmation is authoritative; projection refresh failures cannot undo it.
        const results = await Promise.allSettled([accountSecurityChanged(client), refreshPrincipal()]);
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
  }, [t, tErrors, token, client, refreshPrincipal, principalLoading]);

  if (token === null || (token && state === 'confirming')) {
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
    <AuthCard title={t('emailChangeFailedTitle')} subtitle={error || t('emailChangeLinkInvalid')}>
      <Button asChild size="lg" className="w-full bg-orange-500 font-semibold text-white hover:bg-orange-600">
        <Link href="/settings/security">{t('backToSecurity')}</Link>
      </Button>
    </AuthCard>
  );
}
