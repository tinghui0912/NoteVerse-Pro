'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useFragmentToken } from '@/features/authentication/fragment-token';

import { AuthCard } from '@/components/auth/auth-card';
import { InlineLoading } from '@/components/loading';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { authenticationApi } from '../api';
import { ApiError } from '@/lib/http/customer-browser-transport';
import { translateErrorCode } from '@/lib/i18n/error-message';

type VerifyState = 'verifying' | 'success' | 'error';

export default function VerifyEmailPage() {
  const t = useTranslations('auth');
  const tErrors = useTranslations('errors');
  const token = useFragmentToken();
  const request = useRef<Promise<unknown> | null>(null);
  const [state, setState] = useState<VerifyState>('verifying');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;

    let isMounted = true;
    request.current ??= authenticationApi.verifyEmail(token);
    request.current
      .then(() => {
        if (isMounted) setState('success');
      })
      .catch((err) => {
        if (!isMounted) return;
        setState('error');
        if (err instanceof ApiError) {
          setError(
            err.code === 'token_invalid_expired'
              ? t('verifyEmailLinkInvalid')
              : translateErrorCode(tErrors, err.code, t('verifyEmailLinkInvalid'))
          );
        } else {
          setError(t('verifyFailedRetry'));
        }
      });

    return () => {
      isMounted = false;
    };
  }, [t, tErrors, token]);

  if (token === null || (token && state === 'verifying')) {
    return (
      <AuthCard title={t('verifyingEmailTitle')} subtitle={t('verifyingEmailSubtitle')}>
        <div className="flex justify-center py-6 text-orange-600">
          <InlineLoading />
        </div>
      </AuthCard>
    );
  }

  if (state === 'success') {
    return (
      <AuthCard title={t('emailVerifiedTitle')} subtitle={t('emailVerifiedSubtitle')}>
        <Button asChild size="lg" className="w-full bg-orange-500 font-semibold text-white hover:bg-orange-600">
          <Link href="/auth/login">{t('loginButton')}</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('verifyEmailFailedTitle')} subtitle={error || t('verifyEmailLinkInvalid')}>
      <Button asChild size="lg" className="w-full bg-orange-500 font-semibold text-white hover:bg-orange-600">
        <Link href="/auth/register">{t('registerHere')}</Link>
      </Button>
    </AuthCard>
  );
}
