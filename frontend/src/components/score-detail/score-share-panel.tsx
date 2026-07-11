'use client';

import { useMemo, useState } from 'react';
import {
  Copy,
  Download,
  Dumbbell,
  Link2Off,
  LockKeyhole,
  MessageCircle,
  RotateCcw,
  Send,
  Trash2,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { routing } from '@/i18n/routing';
import { InlineLoading } from '@/components/loading';
import { SectionLoading } from '@/components/loading';
import { EmptyState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import {
  useCreateScoreGrant,
  useDeleteScoreGrant,
  useRestoreScoreGrant,
  useRevokeScoreGrant,
  useScoreGrants,
} from '@/hooks/queries/use-score-queries';
import { useToast } from '@/hooks/use-toast';
import { ApiError } from '@/lib/api-client';
import { formatApiDateTime, parseApiDate } from '@/lib/date-time';
import { translateErrorCode } from '@/lib/i18n/error-message';
import { getShareExpirationDays } from '@/lib/score-detail/share';
import type { ScoreGrant } from '@/types/api';

function absoluteShareUrl(token: string, locale: string) {
  const path = locale === routing.defaultLocale ? `/share/${token}` : `/${locale}/share/${token}`;
  return `${window.location.origin}${path}`;
}

export function ScoreSharePanel({
  scoreTitle,
  scoreId,
}: {
  scoreTitle: string;
  scoreId: string;
}) {
  const t = useTranslations('scoreShare');
  const common = useTranslations('common');
  const errors = useTranslations('errors');
  const locale = useLocale();
  const { toast } = useToast();
  const [expiration, setExpiration] = useState('permanent');
  const [customDate, setCustomDate] = useState('');
  const [allowDownload, setAllowDownload] = useState(true);
  const [allowPractice, setAllowPractice] = useState(true);
  const [created, setCreated] = useState<{ grantId: string; token: string } | null>(null);
  const [createdTokens, setCreatedTokens] = useState<Record<string, string>>({});
  const [now] = useState(() => Date.now());
  const [minimumCustomDate] = useState(
    () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  );
  const grantsQuery = useScoreGrants(scoreId);
  const createGrant = useCreateScoreGrant(scoreId);
  const revokeGrant = useRevokeScoreGrant(scoreId);
  const restoreGrant = useRestoreScoreGrant(scoreId);
  const deleteGrant = useDeleteScoreGrant(scoreId);
  const grants = useMemo(() => grantsQuery.data?.data ?? [], [grantsQuery.data]);

  const copyLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(absoluteShareUrl(token, locale));
      toast({ title: common('copied'), description: t('linkCopied') });
    } catch {
      toast({
        title: t('copyFailed'),
        description: t('copyFailedDescription'),
        variant: 'destructive',
      });
    }
  };

  const create = () => {
    const days = getShareExpirationDays(expiration, customDate);
    if (days === undefined) {
      toast({
        title: t('invalidExpiration'),
        description: t('chooseCustomDate'),
        variant: 'destructive',
      });
      return;
    }
    createGrant.mutate(
      {
        allow_download: allowDownload,
        allow_practice: allowPractice,
        expires_at: days === null ? null : new Date(Date.now() + days * 86_400_000).toISOString(),
      },
      {
        onSuccess: (response) => {
          const data = response.data;
          if (data) {
            setCreated({ grantId: data.grant_id, token: data.token });
            setCreatedTokens((current) => ({
              ...current,
              [data.grant_id]: data.token,
            }));
          }
          toast({ title: t('created'), description: t('createdDescription') });
        },
        onError: (error) =>
          toast({
            title: t('createFailed'),
            description: error instanceof ApiError
              ? translateErrorCode(errors, error.code, t('createFailedDescription'))
              : t('createFailedDescription'),
            variant: 'destructive',
          }),
      }
    );
  };

  const isActive = (grant: ScoreGrant) =>
    !grant.revoked_at && (!grant.expires_at || (parseApiDate(grant.expires_at)?.getTime() ?? 0) > now);
  const isExpired = (grant: ScoreGrant) =>
    Boolean(grant.expires_at && (parseApiDate(grant.expires_at)?.getTime() ?? 0) <= now);
  const daysUntilExpiration = (grant: ScoreGrant) => {
    const expiresAt = parseApiDate(grant.expires_at ?? undefined);
    if (!expiresAt) return null;
    return Math.max(0, Math.ceil((expiresAt.getTime() - now) / 86_400_000));
  };
  const formatExpirationSummary = (grant: ScoreGrant) => {
    if (grant.revoked_at) return t('disabled');
    if (isExpired(grant)) return t('expired');
    const days = daysUntilExpiration(grant);
    if (days === null) return t('permanentValid');
    if (days === 0) return t('expiresToday');
    return t('expiresInDays', { count: days });
  };
  const formatExpirationDetail = (grant: ScoreGrant) =>
    grant.expires_at ? t('expiresAt', { date: formatApiDateTime(grant.expires_at, locale) }) : null;
  const mutationBusy = revokeGrant.isPending || restoreGrant.isPending || deleteGrant.isPending;

  const revoke = (grantId: string) => {
    revokeGrant.mutate(grantId, {
      onSuccess: () => toast({ title: t('disabled'), description: t('disabledDescription') }),
      onError: (error) =>
        toast({
          title: t('disableFailed'),
          description: error instanceof ApiError
            ? translateErrorCode(errors, error.code, t('disableFailedDescription'))
            : t('disableFailedDescription'),
          variant: 'destructive',
        }),
    });
  };

  const restore = (grantId: string) => {
    restoreGrant.mutate(grantId, {
      onSuccess: () => toast({ title: t('enabled'), description: t('enabledDescription') }),
      onError: (error) =>
        toast({
          title: t('enableFailed'),
          description: error instanceof ApiError
            ? translateErrorCode(errors, error.code, t('enableFailedDescription'))
            : t('enableFailedDescription'),
          variant: 'destructive',
        }),
    });
  };

  const deleteExistingGrant = (grantId: string) => {
    deleteGrant.mutate(grantId, {
      onSuccess: () => {
        if (grantId === created?.grantId) setCreated(null);
        setCreatedTokens((current) => {
          const next = { ...current };
          delete next[grantId];
          return next;
        });
        toast({ title: t('deleted'), description: t('deletedDescription') });
      },
      onError: (error) =>
        toast({
          title: t('deleteFailed'),
          description: error instanceof ApiError
            ? translateErrorCode(errors, error.code, t('deleteFailedDescription'))
            : t('deleteFailedDescription'),
          variant: 'destructive',
        }),
    });
  };

  const shareCreatedLink = async () => {
    if (!created) return;
    const url = absoluteShareUrl(created.token, locale);
    if (navigator.share) await navigator.share({ title: scoreTitle, url });
    else await copyLink(created.token);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{t('title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('scoreName', { name: scoreTitle })}</p>
      </div>
          <div className="rounded-lg border bg-muted/60 p-4 text-sm">
            <div className="mb-2 flex items-center gap-2 font-medium text-foreground">
              <LockKeyhole className="h-4 w-4" />
              {t('viewOnly')}
            </div>
            <p className="text-muted-foreground">{t('viewDescription')}</p>
          </div>
          <div className="space-y-3">
            <Label>{t('permissions')}</Label>
            <div className="divide-y rounded-lg border">
              <div className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium">
                    <Download className="h-4 w-4" />
                    {t('allowDownload')}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{t('allowDownloadDescription')}</p>
                </div>
                <Switch
                  checked={allowDownload}
                  onCheckedChange={setAllowDownload}
                  aria-label={t('allowDownload')}
                />
              </div>
              <div className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium">
                    <Dumbbell className="h-4 w-4" />
                    {t('allowPractice')}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{t('allowPracticeDescription')}</p>
                </div>
                <Switch
                  checked={allowPractice}
                  onCheckedChange={setAllowPractice}
                  aria-label={t('allowPractice')}
                />
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <Label>{t('expiration')}</Label>
            <RadioGroup
              value={expiration}
              onValueChange={setExpiration}
              className="grid gap-3 sm:grid-cols-4"
            >
              {[
                ['permanent', t('permanent')],
                ['7d', t('sevenDays')],
                ['30d', t('thirtyDays')],
                ['custom', t('custom')],
              ].map(([value, label]) => (
                <div key={value} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                  <RadioGroupItem id={`share-${value}`} value={value} />
                  <Label htmlFor={`share-${value}`} className="font-normal">
                    {label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
            {expiration === 'custom' ? (
              <Input
                aria-label={t('customDate')}
                type="date"
                min={minimumCustomDate}
                value={customDate}
                onChange={(event) => setCustomDate(event.target.value)}
              />
            ) : null}
          </div>
          <Button className="w-full" onClick={create} disabled={createGrant.isPending}>
            {createGrant.isPending ? (
              <InlineLoading label={t('generateViewOnly')} />
            ) : (
              t('generateViewOnly')
            )}
          </Button>
          {created ? (
            <div className="space-y-3">
              <div className="flex gap-2 rounded-lg border bg-muted/30 p-2">
                <Input
                  readOnly
                  value={absoluteShareUrl(created.token, locale)}
                  className="bg-background"
                />
                <Button variant="outline" onClick={() => void copyLink(created.token)}>
                  <Copy className="mr-2 h-4 w-4" />
                  {t('copy')}
                </Button>
              </div>
              <div className="space-y-3">
                <h3 className="font-semibold">{t('quickShare')}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Button variant="outline" onClick={() => void shareCreatedLink()}>
                    <MessageCircle className="mr-2 h-4 w-4 text-green-600" />
                    {t('shareWechat')}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      window.open(
                        `https://service.weibo.com/share/share.php?url=${encodeURIComponent(absoluteShareUrl(created.token, locale))}&title=${encodeURIComponent(scoreTitle)}`,
                        '_blank',
                        'noopener,noreferrer'
                      )
                    }
                  >
                    <Send className="mr-2 h-4 w-4 text-red-500" />
                    {t('shareWeibo')}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
          <div className="space-y-3">
            <h3 className="font-semibold">{t('generatedLinks')}</h3>
            {grantsQuery.isLoading ? (
              <SectionLoading label={common('loading')} className="min-h-16" />
            ) : grants.length ? (
              <ScrollArea className="max-h-64">
                <div className="divide-y pr-3">
                  {grants.map((grant) => {
                    const active = isActive(grant);
                    const expired = isExpired(grant);
                    const knownToken = grant.token ?? createdTokens[grant.grant_id] ?? null;
                    const expirationDetail = formatExpirationDetail(grant);

                    return (
                      <div
                        key={grant.grant_id}
                        className="grid gap-3 py-3 sm:grid-cols-[minmax(0,0.75fr)_minmax(0,1fr)_auto] sm:items-center"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <LockKeyhole className="h-4 w-4 shrink-0" />
                          <div className="min-w-0">
                            <p className="font-medium">{t('viewOnly')}</p>
                          </div>
                        </div>
                        <div className="min-w-0 text-sm">
                          <p className="font-medium">{formatExpirationSummary(grant)}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {[
                              grant.allow_download ? t('downloadAllowed') : t('downloadBlocked'),
                              grant.allow_practice ? t('practiceAllowed') : t('practiceBlocked'),
                            ].join(' · ')}
                          </p>
                          {expirationDetail ? (
                            <p className="truncate text-xs text-muted-foreground">{expirationDetail}</p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!knownToken}
                            onClick={() => knownToken && void copyLink(knownToken)}
                          >
                            <Copy className="mr-1 h-3.5 w-3.5" />
                            {t('copy')}
                          </Button>
                          {active ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => revoke(grant.grant_id)}
                              disabled={mutationBusy}
                            >
                              <Link2Off className="mr-1 h-3.5 w-3.5" />
                              {t('disable')}
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => restore(grant.grant_id)}
                              disabled={mutationBusy || expired}
                            >
                              <RotateCcw className="mr-1 h-3.5 w-3.5" />
                              {t('enable')}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => deleteExistingGrant(grant.grant_id)}
                            disabled={mutationBusy}
                          >
                            <Trash2 className="mr-1 h-3.5 w-3.5" />
                            {t('delete')}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            ) : (
              <EmptyState title={t('noLinks')} className="min-h-0 rounded-lg border border-dashed p-5" />
            )}
          </div>
    </div>
  );
}
