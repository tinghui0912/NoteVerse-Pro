'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { AuthCard } from '@/components/auth/auth-card';
import { InlineLoading } from '@/components/loading';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { authenticationApi } from '../api';
import { ApiError } from '@/lib/http/customer-browser-transport';
import { translateErrorCode } from '@/lib/i18n/error-message';

type VerifyState = 'verifying' | 'success' | 'error';

// Only the currently presented verification token is retained across remounts.
let verificationRequest: {token: string; promise: Promise<void>} | undefined;

function verifyEmailOnce(token: string) {
  if (verificationRequest?.token === token) return verificationRequest.promise;
  const promise = authenticationApi.verifyEmail(token).then(() => undefined).catch((error) => {
    if (verificationRequest?.promise === promise) verificationRequest = undefined;
    throw error;
  });
  verificationRequest = {token, promise};
  return promise;
}

export default function VerifyEmailPage() {
  const t = useTranslations('auth');
  const tErrors = useTranslations('errors');
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [state, setState] = useState<VerifyState>(token ? 'verifying' : 'error');
  const [error, setError] = useState(token ? '' : t('verifyEmailLinkInvalid'));

  useEffect(() => {
    if (!token) return;

    let isMounted = true;
    verifyEmailOnce(token)
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

  if (state === 'verifying') {
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
    <AuthCard title={t('verifyEmailFailedTitle')} subtitle={error}>
      <Button asChild size="lg" className="w-full bg-orange-500 font-semibold text-white hover:bg-orange-600">
        <Link href="/auth/register">{t('registerHere')}</Link>
      </Button>
    </AuthCard>
  );
}
