'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { AuthCard } from '@/components/auth/auth-card';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { authApi } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { translateErrorCode } from '@/lib/i18n/error-message';

type ConfirmState = 'confirming' | 'success' | 'error';

const confirmationRequests = new Map<string, Promise<void>>();

function confirmEmailChangeOnce(token: string) {
  const existingRequest = confirmationRequests.get(token);
  if (existingRequest) return existingRequest;

  const request = authApi.confirmEmailChange(token).then(() => undefined).catch((error) => {
    confirmationRequests.delete(token);
    throw error;
  });
  confirmationRequests.set(token, request);
  return request;
}

export default function ConfirmEmailChangePage() {
  const t = useTranslations('auth');
  const tErrors = useTranslations('errors');
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [state, setState] = useState<ConfirmState>(token ? 'confirming' : 'error');
  const [error, setError] = useState(token ? '' : t('emailChangeLinkInvalid'));

  useEffect(() => {
    if (!token) return;

    let isMounted = true;
    confirmEmailChangeOnce(token)
      .then(() => {
        if (isMounted) setState('success');
      })
      .catch((err) => {
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
  }, [t, tErrors, token]);

  if (state === 'confirming') {
    return (
      <AuthCard title={t('confirmingEmailChangeTitle')} subtitle={t('confirmingEmailChangeSubtitle')}>
        <div className="flex justify-center py-6 text-orange-600">
          <Loader2 className="h-6 w-6 animate-spin" />
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
