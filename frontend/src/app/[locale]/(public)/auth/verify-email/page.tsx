'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { AuthCard } from '@/components/auth/auth-card';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { useAuth } from '@/contexts/auth-context';
import { ApiError } from '@/lib/api-client';
import { translateErrorCode } from '@/lib/i18n/error-message';

type VerifyState = 'verifying' | 'success' | 'error';

const verificationRequests = new Map<string, Promise<void>>();

function verifyEmailOnce(token: string, verifyEmail: (token: string) => Promise<void>) {
  const existingRequest = verificationRequests.get(token);
  if (existingRequest) return existingRequest;

  const request = verifyEmail(token).catch((error) => {
    verificationRequests.delete(token);
    throw error;
  });
  verificationRequests.set(token, request);
  return request;
}

export default function VerifyEmailPage() {
  const t = useTranslations('auth');
  const tErrors = useTranslations('errors');
  const searchParams = useSearchParams();
  const { verifyEmail } = useAuth();
  const token = searchParams.get('token') ?? '';
  const [state, setState] = useState<VerifyState>(token ? 'verifying' : 'error');
  const [error, setError] = useState(token ? '' : t('verifyEmailLinkInvalid'));

  useEffect(() => {
    if (!token) return;

    let isMounted = true;
    verifyEmailOnce(token, verifyEmail)
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
  }, [t, tErrors, token, verifyEmail]);

  if (state === 'verifying') {
    return (
      <AuthCard title={t('verifyingEmailTitle')} subtitle={t('verifyingEmailSubtitle')}>
        <div className="flex justify-center py-6 text-white">
          <Loader2 className="h-6 w-6 animate-spin" />
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
