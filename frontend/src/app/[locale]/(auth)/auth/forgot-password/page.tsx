'use client';

import { useLocale, useTranslations } from 'next-intl';
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { AuthCard } from '@/components/auth/auth-card';
import { InlineLoading } from '@/components/loading/inline-loading';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/auth-context';
import { Link } from '@/i18n/routing';
import { ApiError } from '@/lib/api-client';
import { translateErrorCode } from '@/lib/i18n/error-message';

export default function ForgotPasswordPage() {
  const t = useTranslations('auth');
  const tErrors = useTranslations('errors');
  const locale = useLocale();
  const { isAuthenticated, isLoading: isAuthLoading, requestPasswordReset } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  useEffect(() => {
    if (!isAuthLoading && isAuthenticated) {
      router.replace('/settings/security');
    }
  }, [isAuthenticated, isAuthLoading, router]);

  const handleRequestReset = async (event: React.FormEvent) => {
    event.preventDefault();
    setEmailError('');

    if (!email) {
      setEmailError(t('validation.emailRequired'));
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError(t('validation.invalidEmail'));
      return;
    }

    setIsSubmitting(true);
    try {
      await requestPasswordReset(email, locale === 'en' ? 'en' : 'zh');
      setIsSubmitted(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setEmailError(translateErrorCode(tErrors, err.code, t('resetRequestFailed')));
      } else {
        setEmailError(t('resetRequestFailedRetry'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSubmitted) {
    return (
      <AuthCard title={t('resetEmailSentTitle')} subtitle={t('resetEmailSentSubtitle', { email })}>
        <Button asChild size="lg" className="w-full bg-orange-500 font-semibold text-white hover:bg-orange-600">
          <Link href="/auth/login">{t('backToLogin')}</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('resetPasswordTitle')} subtitle={t('resetPasswordSubtitle')}>
      <form onSubmit={handleRequestReset} className="space-y-6">
        <div className="space-y-2 text-left">
          <Label htmlFor="email">{t('emailLabel')}</Label>
          <Input
            id="email"
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={isSubmitting}
            className="h-12 border-gray-200 bg-white text-base text-gray-950 focus-visible:border-orange-500 focus-visible:ring-orange-100"
          />
          {emailError ? <p className="mt-2 text-sm text-destructive">{emailError}</p> : null}
        </div>
        <div className="flex flex-col gap-4 pt-4">
          <Button
            type="submit"
            size="lg"
            disabled={isSubmitting}
            className="w-full bg-orange-500 font-semibold text-white hover:bg-orange-600"
          >
            {isSubmitting ? (
              <InlineLoading label={t('sendingEmail')} />
            ) : (
              t('sendResetLinkButton')
            )}
          </Button>
          <Button variant="link" asChild className="text-orange-600 hover:text-orange-700">
            <Link href="/auth/login">{t('backToLogin')}</Link>
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}
