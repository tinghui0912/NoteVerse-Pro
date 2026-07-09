'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, KeyRound, Loader2, Monitor, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useRequestEmailChange } from '@/hooks/queries/use-profile-mutations';
import { useToast } from '@/hooks/use-toast';
import { Link } from '@/i18n/routing';
import { profileApi } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { translateErrorCode } from '@/lib/i18n/error-message';
import type { AccountSecurityOverview } from '@/types/api';

function formatDate(value: string | null | undefined, locale: string, fallback: string): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function SecurityRow({
  icon,
  title,
  description,
  value,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  value: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-t border-gray-200 py-5 first:border-t-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gray-50">
          {icon}
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-950">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-gray-500">{description}</p>
          <p className="mt-2 text-xs font-medium text-gray-700">{value}</p>
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
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
  const unknown = t('security.unknown');

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
    <div className="mt-6 space-y-6">
      <div className="rounded-lg border border-gray-200 px-5">
        <SecurityRow
          icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
          title={t('security.emailTitle')}
          description={t('security.emailDescription')}
          value={
            security.email_verified_at
              ? t('security.verifiedAt', {
                  date: formatDate(security.email_verified_at, locale, unknown),
                })
              : t('security.notVerified')
          }
        />
        <SecurityRow
          icon={<KeyRound className="h-5 w-5 text-gray-500" />}
          title={t('security.passwordTitle')}
          description={t('security.passwordDescription')}
          value={t('security.passwordChangedAt', {
            date: formatDate(security.password_changed_at, locale, unknown),
          })}
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/settings/password">{t('security.changePassword')}</Link>
            </Button>
          }
        />
        <SecurityRow
          icon={<Monitor className="h-5 w-5 text-gray-500" />}
          title={t('security.sessionsTitle')}
          description={t('security.sessionsDescription')}
          value={t('security.activeSessions', {
            count: security.active_sessions_count,
          })}
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/settings/sessions">{t('security.manageSessions')}</Link>
            </Button>
          }
        />
        <SecurityRow
          icon={<ShieldCheck className="h-5 w-5 text-gray-500" />}
          title={t('security.mfaTitle')}
          description={t('security.mfaDescription')}
          value={security.mfa_available ? t('security.mfaOff') : t('security.comingSoon')}
        />
        <SecurityRow
          icon={<Clock className="h-5 w-5 text-gray-500" />}
          title={t('security.lastLoginTitle')}
          description={t('security.lastLoginDescription')}
          value={formatDate(security.last_login, locale, unknown)}
        />
      </div>

      <form onSubmit={handleEmailChange} className="rounded-lg border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-950">{t('security.emailChangeTitle')}</h3>
        <p className="mt-1 text-sm leading-6 text-gray-500">
          {t('security.emailChangeDescription', { email: security.email })}
        </p>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
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
          {emailChangeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t('security.sendEmailChange')}
        </Button>
      </form>
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
        <div className="mt-6 flex min-h-32 items-center justify-center rounded-lg border border-gray-200 text-sm text-gray-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {t('security.loading')}
        </div>
      ) : securityQuery.isError ? (
        <div className="mt-6 rounded-lg border border-red-200 p-5 text-sm text-red-600">
          {t('security.loadFailed')}
        </div>
      ) : securityQuery.data?.data?.security ? (
        <SecurityContent security={securityQuery.data.data.security} />
      ) : null}
    </section>
  );
}
