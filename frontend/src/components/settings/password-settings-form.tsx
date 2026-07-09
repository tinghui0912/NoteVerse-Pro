'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useChangePassword } from '@/hooks/queries/use-profile-mutations';
import { useToast } from '@/hooks/use-toast';
import { ApiError } from '@/lib/api-client';
import { translateErrorCode } from '@/lib/i18n/error-message';

export function PasswordSettingsForm() {
  const t = useTranslations('settings');
  const tAuth = useTranslations('auth');
  const tErrors = useTranslations('errors');
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const passwordMutation = useChangePassword();

  const handleUpdatePassword = () => {
    if (newPassword !== confirmPassword) {
      toast({
        title: t('passwordMismatchTitle'),
        description: t('passwordMismatch'),
        variant: 'destructive',
      });
      return;
    }

    if (newPassword.length < 6) {
      toast({
        title: t('passwordTooShortTitle'),
        description: tAuth('validation.passwordTooShort'),
        variant: 'destructive',
      });
      return;
    }

    passwordMutation.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          toast({
            title: t('passwordSuccess'),
            description: t('passwordUpdated'),
          });
          setCurrentPassword('');
          setNewPassword('');
          setConfirmPassword('');
        },
        onError: (error) => {
          toast({
            title: t('passwordFailed'),
            description:
              error instanceof ApiError
                ? translateErrorCode(tErrors, error.code, t('passwordFailedDesc'))
                : t('passwordFailedDesc'),
            variant: 'destructive',
          });
        },
      }
    );
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-2 text-xl font-semibold text-gray-950">{t('password.heading')}</h2>
      <p className="mb-6 max-w-2xl text-sm text-gray-500">{t('password.description')}</p>
      <div className="max-w-xl space-y-4">
        <div className="space-y-2">
          <Label htmlFor="current-password">{t('currentPassword')}</Label>
          <Input
            id="current-password"
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            className="h-12 bg-white"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-password">{t('newPassword')}</Label>
          <Input
            id="new-password"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            className="h-12 bg-white"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm-password">{tAuth('confirmPasswordLabel')}</Label>
          <Input
            id="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="h-12 bg-white"
          />
        </div>
        <Button
          className="bg-orange-500 text-white hover:bg-orange-600"
          onClick={handleUpdatePassword}
          disabled={passwordMutation.isPending}
        >
          {passwordMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : null}
          {t('password.save')}
        </Button>
      </div>
    </section>
  );
}
