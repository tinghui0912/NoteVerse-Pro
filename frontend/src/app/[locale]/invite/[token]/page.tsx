'use client';

import React from 'react';
import { Ban, CheckCircle2, CircleAlert, Clock3, Loader2, SearchX, UserPlus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ScoreShell } from '@/components/score-shell/score-shell';
import { useAuth } from '@/contexts/auth-context';
import { Link } from '@/i18n/routing';
import { useAcceptScoreInvite, useScoreInviteAccess } from '@/hooks/queries/use-score-queries';
import { ApiError } from '@/lib/api-client';
import { translateErrorCode } from '@/lib/i18n/error-message';
import { formatApiDateTime } from '@/lib/date-time';

function getInviteErrorConfig(
  error: unknown,
  t: ReturnType<typeof useTranslations>,
  errors: ReturnType<typeof useTranslations>
) {
  if (!(error instanceof ApiError)) {
    return {
      icon: CircleAlert,
      title: t('loadFailed'),
      description: t('loadFailedDescription'),
    };
  }

  if (error.code === 'invite_not_found') {
    return {
      icon: SearchX,
      title: t('notFoundTitle'),
      description: t('notFoundDescription'),
    };
  }

  if (error.code === 'invite_revoked') {
    return {
      icon: Ban,
      title: t('revokedTitle'),
      description: t('revokedDescription'),
    };
  }

  if (error.code === 'invite_expired') {
    return {
      icon: Clock3,
      title: t('expiredTitle'),
      description: t('expiredDescription'),
    };
  }

  return {
    icon: CircleAlert,
    title: t('loadFailed'),
    description: translateErrorCode(errors, error.code, t('loadFailedDescription')),
  };
}

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = React.use(params);
  const t = useTranslations('scoreCollaboration');
  const common = useTranslations('common');
  const errors = useTranslations('errors');
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();
  const inviteQuery = useScoreInviteAccess(token);
  const acceptInvite = useAcceptScoreInvite();
  const invite = inviteQuery.data?.data ?? null;
  const inviterName = invite?.inviter?.display_name || invite?.inviter?.email || t('unknownInviter');
  const currentUrl = typeof window === 'undefined' ? `/invite/${token}` : `${window.location.pathname}${window.location.search}`;
  const acceptAfterLogin = searchParams.get('accept') === '1';
  const returnUrl = new URL(currentUrl, 'http://noteverse.local');
  returnUrl.searchParams.set('accept', '1');
  const loginHref = `/auth/login?returnUrl=${encodeURIComponent(`${returnUrl.pathname}${returnUrl.search}`)}`;
  const userEmail = user?.email.toLowerCase() ?? null;
  const targetEmail = invite?.email?.toLowerCase() ?? null;
  const emailMatches = !targetEmail || !userEmail || targetEmail === userEmail;
  const refreshedAfterLoginRef = React.useRef(false);
  const autoAcceptRef = React.useRef(false);

  const accept = React.useCallback(() => {
    acceptInvite.mutate(token, {
      onSuccess: (response) => {
        const scoreId = response.data?.score_id;
        if (scoreId) router.push(`/score/${scoreId}`);
      },
    });
  }, [acceptInvite, router, token]);

  React.useEffect(() => {
    if (authLoading || !isAuthenticated || refreshedAfterLoginRef.current) return;
    refreshedAfterLoginRef.current = true;
    void inviteQuery.refetch();
  }, [authLoading, inviteQuery, isAuthenticated]);

  React.useEffect(() => {
    if (!acceptAfterLogin || autoAcceptRef.current || authLoading || !isAuthenticated) return;
    if (!invite || !invite.can_accept || !emailMatches || acceptInvite.isPending) return;
    autoAcceptRef.current = true;
    accept();
  }, [
    accept,
    acceptAfterLogin,
    acceptInvite.isPending,
    authLoading,
    emailMatches,
    invite,
    isAuthenticated,
  ]);

  if (authLoading || inviteQuery.isLoading) {
    return (
      <ScoreShell footer={false}>
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </ScoreShell>
    );
  }

  if (inviteQuery.error || !invite) {
    const config = getInviteErrorConfig(inviteQuery.error, t, errors);
    return (
      <ScoreShell footer={false}>
        <div className="flex min-h-screen items-center justify-center px-4 py-16">
          <div className="w-full max-w-md text-center">
            <config.icon className="mx-auto mb-6 h-14 w-14 text-destructive" />
            <h1 className="mb-3 text-2xl font-bold">{config.title}</h1>
            <p className="mb-8 text-muted-foreground">{config.description}</p>
            <Button asChild>
              <Link href="/">{t('backHome')}</Link>
            </Button>
          </div>
        </div>
      </ScoreShell>
    );
  }

  const statusMessage = invite.status === 'ACCEPTED'
    ? t('alreadyAccepted')
    : invite.status === 'REVOKED'
      ? t('revokedDescription')
      : invite.status === 'EXPIRED'
        ? t('expiredDescription')
        : null;

  return (
    <ScoreShell footer={false}>
      <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-16">
        <div className="w-full max-w-lg rounded-2xl border bg-background p-8 shadow-sm">
          <div className="mb-8 text-center">
            <UserPlus className="mx-auto mb-5 h-12 w-12 text-primary" />
            <p className="mb-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
              {t('invitePageTitle')}
            </p>
            <h1 className="text-3xl font-bold">{invite.score_title}</h1>
            <p className="mt-3 text-muted-foreground">
              {t('invitedBy', { name: inviterName })}
            </p>
          </div>

          <div className="space-y-3 rounded-xl border bg-muted/30 p-4 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t('role')}</span>
              <span className="font-medium">{invite.role === 'EDITOR' ? t('editor') : t('viewer')}</span>
            </div>
            {invite.email ? (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">{t('email')}</span>
                <span className="font-medium">{invite.email}</span>
              </div>
            ) : null}
            {invite.expires_at ? (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">{t('expiresAt')}</span>
                <span className="font-medium">{formatApiDateTime(invite.expires_at, locale)}</span>
              </div>
            ) : null}
          </div>

          {statusMessage ? (
            <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              {statusMessage}
            </div>
          ) : null}

          {isAuthenticated && !emailMatches ? (
            <div className="mt-6 rounded-xl border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">
              {t('cannotAccept')}
            </div>
          ) : null}

          {acceptInvite.error ? (
            <div className="mt-6 rounded-xl border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">
              {acceptInvite.error instanceof ApiError
                ? translateErrorCode(errors, acceptInvite.error.code, t('acceptFailedDescription'))
                : t('acceptFailedDescription')}
            </div>
          ) : null}

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            {!isAuthenticated ? (
              <Button asChild className="flex-1">
                <Link href={loginHref}>{t('loginToAccept')}</Link>
              </Button>
            ) : invite.status === 'ACCEPTED' ? (
              <Button className="flex-1" onClick={() => router.push(`/score/${invite.score_id}`)}>
                <CheckCircle2 className="h-4 w-4" />
                {t('openScore')}
              </Button>
            ) : (
              <Button
                className="flex-1"
                disabled={!invite.can_accept || !emailMatches || acceptInvite.isPending}
                onClick={accept}
              >
                {acceptInvite.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                {acceptInvite.isPending ? t('accepting') : t('acceptInvite')}
              </Button>
            )}
            <Button variant="outline" onClick={() => router.push('/')}>
              {common('nav.home')}
            </Button>
          </div>
        </div>
      </div>
    </ScoreShell>
  );
}
