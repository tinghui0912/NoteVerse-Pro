'use client';

import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Monitor, ShieldCheck, Smartphone } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useRevokeOtherSessions, useRevokeSession } from '@/hooks/queries/use-profile-mutations';
import { useToast } from '@/hooks/use-toast';
import { profileApi } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { translateErrorCode } from '@/lib/i18n/error-message';
import type { AccountSession } from '@/types/api';

const sessionsQueryKey = ['account', 'sessions'];

function deviceLabel(session: AccountSession, fallback: string): string {
  const agent = session.user_agent ?? '';
  if (!agent) return fallback;
  if (/iPhone|Android|Mobile/i.test(agent)) return 'Mobile browser';
  if (/iPad|Tablet/i.test(agent)) return 'Tablet browser';
  if (/Chrome/i.test(agent)) return 'Chrome';
  if (/Firefox/i.test(agent)) return 'Firefox';
  if (/Safari/i.test(agent)) return 'Safari';
  if (/Edge/i.test(agent)) return 'Edge';
  return fallback;
}

function formatDate(value: string | null | undefined, locale: string, fallback: string): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function SessionIcon({ session }: { session: AccountSession }) {
  const agent = session.user_agent ?? '';
  if (/iPhone|Android|Mobile|iPad|Tablet/i.test(agent)) {
    return <Smartphone className="h-5 w-5 text-gray-500" />;
  }
  return <Monitor className="h-5 w-5 text-gray-500" />;
}

export function SessionsSettingsPanel() {
  const t = useTranslations('settings');
  const tErrors = useTranslations('errors');
  const locale = useLocale();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const sessionsQuery = useQuery({
    queryKey: sessionsQueryKey,
    queryFn: () => profileApi.getSessions(),
  });

  const sessions = useMemo(
    () => sessionsQuery.data?.data?.sessions ?? [],
    [sessionsQuery.data]
  );

  const revokeSession = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const isMutating = revokeSession.isPending || revokeOthers.isPending;

  const showErrorToast = (error: unknown) => {
    toast({
      title: t('sessions.actionFailed'),
      description:
        error instanceof ApiError
          ? translateErrorCode(tErrors, error.code, t('sessions.actionFailedDesc'))
          : t('sessions.actionFailedDesc'),
      variant: 'destructive',
    });
  };

  const refreshSessions = () => {
    void queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
  };

  const handleRevoke = (sessionId: number) => {
    revokeSession.mutate(sessionId, {
      onSuccess: () => {
        toast({
          title: t('sessions.revokedTitle'),
          description: t('sessions.revokedDesc'),
        });
        refreshSessions();
      },
      onError: showErrorToast,
    });
  };

  const handleRevokeOthers = () => {
    revokeOthers.mutate(undefined, {
      onSuccess: () => {
        toast({
          title: t('sessions.revokedOthersTitle'),
          description: t('sessions.revokedOthersDesc'),
        });
        refreshSessions();
      },
      onError: showErrorToast,
    });
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="mb-2 text-xl font-semibold text-gray-950">{t('sessions.heading')}</h2>
          <p className="max-w-2xl text-sm leading-6 text-gray-500">
            {t('sessions.description')}
          </p>
        </div>
        <Button
          variant="outline"
          disabled={isMutating || sessions.filter((session) => !session.is_current).length === 0}
          onClick={handleRevokeOthers}
        >
          {revokeOthers.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t('sessions.revokeOthers')}
        </Button>
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-gray-200">
        {sessionsQuery.isLoading ? (
          <div className="flex min-h-32 items-center justify-center text-sm text-gray-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t('sessions.loading')}
          </div>
        ) : sessionsQuery.isError ? (
          <div className="p-5 text-sm text-red-600">{t('sessions.loadFailed')}</div>
        ) : sessions.length === 0 ? (
          <div className="p-5 text-sm text-gray-500">{t('sessions.empty')}</div>
        ) : (
          <div className="divide-y divide-gray-200">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gray-50">
                    <SessionIcon session={session} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-gray-950">
                        {deviceLabel(session, t('sessions.unknownDevice'))}
                      </p>
                      {session.is_current ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          <ShieldCheck className="h-3.5 w-3.5" />
                          {t('sessions.current')}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-2 grid gap-1 text-xs text-gray-500 sm:grid-cols-2">
                      <span>{t('sessions.ip')}: {session.ip_address ?? t('sessions.unknown')}</span>
                      <span>
                        {t('sessions.created')}: {formatDate(session.created_at, locale, t('sessions.unknown'))}
                      </span>
                      <span>
                        {t('sessions.lastUsed')}: {formatDate(session.last_used_at, locale, t('sessions.never'))}
                      </span>
                      <span>
                        {t('sessions.expires')}: {formatDate(session.expires_at, locale, t('sessions.unknown'))}
                      </span>
                    </div>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isMutating || session.is_current}
                  onClick={() => handleRevoke(session.id)}
                >
                  {revokeSession.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {session.is_current ? t('sessions.currentAction') : t('sessions.revoke')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
