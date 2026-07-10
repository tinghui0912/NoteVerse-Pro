'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Check, CircleAlert, KeyRound, Loader2, Mail, ShieldCheck } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { SectionLoading } from '@/components/loading/section-loading';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordSettingsForm } from '@/components/settings/password-settings-form';
import { useRequestEmailChange } from '@/hooks/queries/use-profile-mutations';
import { useToast } from '@/hooks/use-toast';
import { profileApi } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { translateErrorCode } from '@/lib/i18n/error-message';
import { formatApiDateTime } from '@/lib/date-time';
import type { AccountSecurityOverview } from '@/types/api';

function SecurityRow({
  icon,
  title,
  description,
  value,
  status,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  value?: string;
  status?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-t border-gray-200 first:border-t-0">
      <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gray-50">
            {icon}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-950">{title}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <p className="break-all text-sm leading-6 text-gray-500">{description}</p>
              {status}
            </div>
            {value ? <p className="mt-2 text-xs font-medium text-gray-700">{value}</p> : null}
          </div>
        </div>
        {action ? <div className="shrink-0 sm:pl-4">{action}</div> : null}
      </div>
      {children ? <div className="px-5 pb-6 sm:pl-[76px]">{children}</div> : null}
    </div>
  );
}

function SecurityContent({ security }: { security: AccountSecurityOverview }) {
  const t = useTranslations('settings');
  const tAuth = useTranslations('auth');
  const tErrors = useTranslations('errors');
  const locale = useLocale();
  const { toast } = useToast();
  const emailChangeMutation = useRequestEmailChange();
  const [newEmail, setNewEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [isEmailFormOpen, setIsEmailFormOpen] = useState(false);
  const [isPasswordFormOpen, setIsPasswordFormOpen] = useState(false);

  const handleEmailChange = (event: React.FormEvent) => {
    event.preventDefault();

    if (!newEmail.trim()) {
      toast({
        title: t('security.emailChangeFailed'),
        description: tAuth('validation.emailEmpty'),
        variant: 'destructive',
      });
      return;
    }

    if (!currentPassword) {
      toast({
        title: t('security.emailChangeFailed'),
        description: t('security.currentPasswordRequired'),
        variant: 'destructive',
      });
      return;
    }

    emailChangeMutation.mutate(
      {
        new_email: newEmail.trim(),
        current_password: currentPassword,
        locale: locale === 'en' ? 'en' : 'zh',
      },
      {
        onSuccess: () => {
          toast({
            title: t('security.emailChangeSentTitle'),
            description: t('security.emailChangeSentDesc', { email: newEmail.trim() }),
          });
          setNewEmail('');
          setCurrentPassword('');
          setIsEmailFormOpen(false);
        },
        onError: (error) => {
          toast({
            title: t('security.emailChangeFailed'),
            description:
              error instanceof ApiError
                ? translateErrorCode(tErrors, error.code, t('security.emailChangeFailedDesc'))
                : t('security.emailChangeFailedDesc'),
            variant: 'destructive',
          });
        },
      }
    );
  };

  return (
    <div className="mt-6">
      <div className="overflow-hidden rounded-lg border border-gray-200">
        <SecurityRow
          icon={<Mail className="h-5 w-5 text-gray-700" />}
          title={t('security.emailTitle')}
          description={security.email}
          status={
            security.email_verified_at
              ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                    <Check className="h-3 w-3" />
                    {t('security.verifiedTag')}
                  </span>
                )
              : (
                  <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                    {t('security.notVerified')}
                  </span>
                )
          }
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsEmailFormOpen((isOpen) => !isOpen)}
            >
              {isEmailFormOpen ? t('security.hide') : t('security.changeEmail')}
            </Button>
          }
        >
          {isEmailFormOpen ? (
            <form onSubmit={handleEmailChange} className="max-w-2xl">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="new-email">{t('security.newEmail')}</Label>
                  <Input
                    id="new-email"
                    type="email"
                    value={newEmail}
                    onChange={(event) => setNewEmail(event.target.value)}
                    disabled={emailChangeMutation.isPending}
                    className="h-12 bg-white"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email-current-password">{t('currentPassword')}</Label>
                  <Input
                    id="email-current-password"
                    type="password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    disabled={emailChangeMutation.isPending}
                    className="h-12 bg-white"
                  />
                </div>
              </div>
              <Button
                type="submit"
                className="mt-5 bg-orange-500 text-white hover:bg-orange-600"
                disabled={emailChangeMutation.isPending}
              >
                {emailChangeMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {t('security.sendEmailChange')}
              </Button>
            </form>
          ) : null}
        </SecurityRow>
        <SecurityRow
          icon={<KeyRound className="h-5 w-5 text-gray-500" />}
          title={t('security.passwordTitle')}
          description={t('security.passwordChangedAt', {
            date: formatApiDateTime(security.password_changed_at, locale),
          })}
          status={
            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
              {t('security.configured')}
            </span>
          }
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsPasswordFormOpen((isOpen) => !isOpen)}
            >
              {isPasswordFormOpen ? t('security.hide') : t('security.changePassword')}
            </Button>
          }
        >
          {isPasswordFormOpen ? <PasswordSettingsForm embedded showHeader={false} /> : null}
        </SecurityRow>
        <SecurityRow
          icon={<ShieldCheck className="h-5 w-5 text-gray-500" />}
          title={t('security.mfaTitle')}
          description={t('security.mfaDescription')}
          value={security.mfa_available ? t('security.mfaOff') : t('security.comingSoon')}
        />
      </div>
    </div>
  );
}

export function SecuritySettingsPanel() {
  const t = useTranslations('settings');
  const securityQuery = useQuery({
    queryKey: ['account', 'security'],
    queryFn: () => profileApi.getSecurityOverview(),
  });

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-2 text-xl font-semibold text-gray-950">{t('security.heading')}</h2>
      <p className="max-w-2xl text-sm leading-6 text-gray-500">{t('security.description')}</p>

      {securityQuery.isLoading ? (
        <SectionLoading
          label={t('security.loading')}
          className="mt-6 rounded-lg border border-gray-200"
        />
      ) : securityQuery.isError ? (
        <Alert variant="destructive" className="mt-6">
          <CircleAlert className="h-4 w-4" />
          <AlertDescription>{t('security.loadFailed')}</AlertDescription>
        </Alert>
      ) : securityQuery.data?.data?.security ? (
        <SecurityContent security={securityQuery.data.data.security} />
      ) : null}
    </section>
  );
}
