'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { AuthCard } from '@/components/auth/auth-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Link } from '@/i18n/routing';
import { useAuth } from '@/contexts/auth-context';
import { ApiError } from '@/lib/api-client';
import { translateErrorCode } from '@/lib/i18n/error-message';

export default function ResetPasswordPage() {
  const t = useTranslations('auth');
  const tErrors = useTranslations('errors');
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { resetPassword } = useAuth();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canReset = Boolean(token);

  const handleResetPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    if (!canReset) {
      setError(t('resetLinkInvalid'));
      return;
    }

    if (!password) {
      setError(t('validation.passwordEmpty'));
      return;
    }

    if (password.length < 6) {
      setError(t('validation.passwordTooShort'));
      return;
    }

    if (password !== confirmPassword) {
      setError(t('validation.passwordsDoNotMatch'));
      return;
    }

    setIsSubmitting(true);

    try {
      await resetPassword(password, token, locale === 'en' ? 'en' : 'zh');
      router.push('/auth/login?reset=success');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(translateErrorCode(tErrors, err.code, t('resetFailed')));
      } else {
        setError(t('resetFailedRetry'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthCard title={t('setNewPasswordTitle')} subtitle={t('setNewPasswordSubtitle')}>
      {!canReset ? (
        <div className="space-y-6">
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
            {t('resetLinkInvalid')}
          </div>
          <Button asChild size="lg" className="w-full bg-orange-500 font-semibold text-white hover:bg-orange-600">
            <Link href="/auth/forgot-password">{t('requestNewReset')}</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={handleResetPassword} className="space-y-6">
          <div className="space-y-2 text-left">
            <Label htmlFor="password">{t('newPasswordLabel')}</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={isSubmitting}
              className="h-12 border-gray-700 bg-gray-800 text-base text-white focus-visible:border-white focus-visible:ring-transparent"
            />
          </div>
          <div className="space-y-2 text-left">
            <Label htmlFor="confirm-password">{t('confirmPasswordLabel')}</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              disabled={isSubmitting}
              className="h-12 border-gray-700 bg-gray-800 text-base text-white focus-visible:border-white focus-visible:ring-transparent"
            />
          </div>
          {error ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
              {error}
            </div>
          ) : null}
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
                  {t('resettingPassword')}
                </>
              ) : (
                t('resetPasswordButton')
              )}
            </Button>
            <Button variant="link" asChild className="text-white">
              <Link href="/auth/login">{t('backToLogin')}</Link>
            </Button>
          </div>
        </form>
      )}
    </AuthCard>
  );
}
