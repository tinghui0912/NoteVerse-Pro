'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { AuthCard } from '@/components/auth/auth-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/auth-context';
import { Link } from '@/i18n/routing';
import { withReturnUrl } from '@/lib/auth/return-url';
import { ApiError } from '@/lib/api-client';
import { translateErrorCode } from '@/lib/i18n/error-message';

export default function RegisterPage() {
  const t = useTranslations('auth');
  const tErrors = useTranslations('errors');
  const locale = useLocale();
  const { isAuthenticated, isLoading: isAuthLoading, register } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const returnUrl = searchParams.get('returnUrl');

  useEffect(() => {
    if (!isAuthLoading && isAuthenticated) {
      router.replace('/library');
    }
  }, [isAuthenticated, isAuthLoading, router]);

  const handleRegister = async (event: React.FormEvent) => {
    event.preventDefault();
    setEmailError('');
    setPasswordError('');
    setFormError('');

    if (!email) {
      setEmailError(t('validation.emailEmpty'));
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError(t('validation.emailInvalid'));
      return;
    }
    if (!password) {
      setPasswordError(t('validation.passwordEmpty'));
      return;
    }
    if (password.length < 6) {
      setPasswordError(t('validation.passwordTooShort'));
      return;
    }

    setIsSubmitting(true);
    try {
      await register(
        email,
        password,
        displayName || email.split('@')[0],
        locale === 'en' ? 'en' : 'zh'
      );
      setIsSubmitted(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(translateErrorCode(tErrors, err.code, t('registerFailed')));
      } else {
        setFormError(t('registerFailed'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSubmitted) {
    return (
      <AuthCard title={t('verifyEmailSentTitle')} subtitle={t('verifyEmailSentSubtitle', { email })}>
        <div className="flex flex-col gap-4">
          <Button asChild size="lg" className="w-full bg-orange-500 font-semibold text-white hover:bg-orange-600">
            <Link href="/auth/login">{t('backToLogin')}</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('registerTitle')} subtitle={t('registerSubtitle')}>
      {formError ? (
        <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          {formError}
        </div>
      ) : null}

      <form onSubmit={handleRegister} className="space-y-6">
        <div className="space-y-2 text-left">
          <Label htmlFor="email">{t('emailLabel')}</Label>
          <Input
            id="email"
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={isSubmitting}
            className="h-12 border-gray-700 bg-gray-800 text-base text-white focus-visible:border-white focus-visible:ring-transparent"
          />
          {emailError ? <p className="mt-2 text-sm text-destructive">{emailError}</p> : null}
        </div>
        <div className="space-y-2 text-left">
          <Label htmlFor="displayName">{t('displayNameLabel')}</Label>
          <Input
            id="displayName"
            type="text"
            placeholder={t('displayNamePlaceholder')}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            disabled={isSubmitting}
            className="h-12 border-gray-700 bg-gray-800 text-base text-white focus-visible:border-white focus-visible:ring-transparent"
          />
        </div>
        <div className="space-y-2 text-left">
          <Label htmlFor="password">{t('passwordLabel')}</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={isSubmitting}
            className="h-12 border-gray-700 bg-gray-800 text-base text-white focus-visible:border-white focus-visible:ring-transparent"
          />
          {passwordError ? <p className="mt-2 text-sm text-destructive">{passwordError}</p> : null}
        </div>
        <div className="flex flex-col gap-4 pt-4">
          <Button
            type="submit"
            size="lg"
            disabled={isSubmitting}
            className="w-full bg-orange-500 font-semibold text-white hover:bg-orange-600"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('creatingAccount')}
              </>
            ) : (
              t('registerButton')
            )}
          </Button>
          <p className="text-sm text-muted-foreground">
            {t('haveAccount')}{' '}
            <Link href={withReturnUrl('/auth/login', returnUrl)} className="font-semibold text-white hover:underline">
              {t('loginHere')}
            </Link>
          </p>
        </div>
      </form>
    </AuthCard>
  );
}
