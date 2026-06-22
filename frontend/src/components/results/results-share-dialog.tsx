'use client';

import { useMemo, useState } from 'react';
import { Copy, Eye, Link2Off, Loader2, LockKeyhole, MessageCircle, Pencil, Send } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { routing } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useCreateScoreGrant,
  useRevokeScoreGrant,
  useScoreGrants,
} from '@/hooks/queries/use-score-queries';
import { useToast } from '@/hooks/use-toast';
import { ApiError } from '@/lib/api-client';
import { getShareExpirationDays } from '@/lib/results/share';
import type { ScoreGrant } from '@/types/api';

type Permission = 'edit' | 'view';

function absoluteShareUrl(token: string, locale: string) {
  const path = locale === routing.defaultLocale ? `/share/${token}` : `/${locale}/share/${token}`;
  return `${window.location.origin}${path}`;
}

export function ResultsShareDialog({
  onOpenChange,
  open,
  scoreTitle,
  scoreId,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  scoreTitle: string;
  scoreId: string;
}) {
  const t = useTranslations('resultsShare');
  const common = useTranslations('common');
  const locale = useLocale();
  const { toast } = useToast();
  const [permission, setPermission] = useState<Permission>('view');
  const [expiration, setExpiration] = useState('permanent');
  const [customDate, setCustomDate] = useState('');
  const [created, setCreated] = useState<{ grantId: string; token: string } | null>(null);
  const [minimumCustomDate] = useState(
    () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  );
  const grantsQuery = useScoreGrants(scoreId, open);
  const createGrant = useCreateScoreGrant(scoreId);
  const revokeGrant = useRevokeScoreGrant(scoreId);
  const grants = useMemo(() => grantsQuery.data?.data ?? [], [grantsQuery.data]);

  const copyLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(absoluteShareUrl(token, locale));
      toast({ title: common('copied'), description: t('linkCopied') });
    } catch {
      toast({ title: t('copyFailed'), description: t('copyFailedDescription'), variant: 'destructive' });
    }
  };

  const create = () => {
    const days = getShareExpirationDays(expiration, customDate);
    if (days === undefined) {
      toast({ title: t('invalidExpiration'), description: t('chooseCustomDate'), variant: 'destructive' });
      return;
    }
    createGrant.mutate(
      {
        scope: permission === 'edit' ? 'EDIT_INVITE' : 'VIEW',
        allow_download: true,
        allow_practice: true,
        expires_at: days === null ? null : new Date(Date.now() + days * 86_400_000).toISOString(),
      },
      {
        onSuccess: (response) => {
          if (response.data) setCreated({ grantId: response.data.grant_id, token: response.data.token });
          toast({ title: t('created'), description: t('createdDescription') });
        },
        onError: (error) => toast({
          title: t('createFailed'),
          description: error instanceof ApiError ? error.message : t('createFailedDescription'),
          variant: 'destructive',
        }),
      }
    );
  };

  const isActive = (grant: ScoreGrant) =>
    !grant.revoked_at && (!grant.expires_at || new Date(grant.expires_at) > new Date());
  const formatExpiration = (grant: ScoreGrant) => grant.expires_at
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(grant.expires_at))
    : t('permanent');
  const shareCreatedLink = async () => {
    if (!created) return;
    const url = absoluteShareUrl(created.token, locale);
    if (navigator.share) await navigator.share({ title: scoreTitle, url });
    else await copyLink(created.token);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto rounded-2xl p-0">
        <div className="space-y-6 p-6 sm:p-8">
          <DialogHeader><DialogTitle className="text-2xl">{t('title')}</DialogTitle><DialogDescription>{t('scoreName', { name: scoreTitle })}</DialogDescription></DialogHeader>
          <Tabs value={permission} onValueChange={(value) => setPermission(value as Permission)}>
            <TabsList className="grid h-auto w-full grid-cols-2"><TabsTrigger value="view" className="gap-2 py-3"><Eye className="h-4 w-4" />{t('viewOnly')}</TabsTrigger><TabsTrigger value="edit" className="gap-2 py-3"><Pencil className="h-4 w-4" />{t('editable')}</TabsTrigger></TabsList>
            <TabsContent value="view" className="rounded-lg bg-muted/60 p-4 text-sm text-muted-foreground">{t('viewDescription')}</TabsContent>
            <TabsContent value="edit" className="rounded-lg bg-muted/60 p-4 text-sm text-muted-foreground">{t('editDescription')}</TabsContent>
          </Tabs>
          <div className="space-y-3">
            <Label>{t('expiration')}</Label>
            <RadioGroup value={expiration} onValueChange={setExpiration} className="grid gap-3 sm:grid-cols-4">
              {[["permanent", t('permanent')], ["7d", t('sevenDays')], ["30d", t('thirtyDays')], ["custom", t('custom')]].map(([value, label]) => <div key={value} className="flex items-center gap-2 rounded-lg border px-3 py-2"><RadioGroupItem id={`share-${value}`} value={value} /><Label htmlFor={`share-${value}`} className="font-normal">{label}</Label></div>)}
            </RadioGroup>
            {expiration === 'custom' ? <Input aria-label={t('customDate')} type="date" min={minimumCustomDate} value={customDate} onChange={(event) => setCustomDate(event.target.value)} /> : null}
          </div>
          <Button className="w-full" onClick={create} disabled={createGrant.isPending}>{createGrant.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : permission === 'edit' ? t('generateEditable') : t('generateViewOnly')}</Button>
          {created ? <div className="flex gap-2 rounded-lg border bg-muted/30 p-2"><Input readOnly value={absoluteShareUrl(created.token, locale)} className="bg-background" /><Button variant="outline" onClick={() => void copyLink(created.token)}><Copy className="mr-2 h-4 w-4" />{t('copy')}</Button></div> : null}
          <div className="space-y-3">
            <h3 className="font-semibold">{t('generatedLinks')}</h3>
            {grantsQuery.isLoading ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /> : grants.length ? (
              <ScrollArea className="max-h-64"><div className="divide-y pr-3">{grants.map((grant) => {
                const active = isActive(grant);
                const knownToken = grant.grant_id === created?.grantId ? created.token : null;
                return <div key={grant.grant_id} className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="flex min-w-0 items-center gap-3">{grant.scope === 'EDIT_INVITE' ? <Pencil className="h-4 w-4 shrink-0" /> : <LockKeyhole className="h-4 w-4 shrink-0" />}<div className="min-w-0"><p className="font-medium">{grant.scope === 'EDIT_INVITE' ? t('editable') : t('viewOnly')}</p><p className="truncate text-xs text-muted-foreground">{active ? formatExpiration(grant) : grant.revoked_at ? t('disabled') : t('expired')}</p></div></div><div className="flex gap-2"><Button size="sm" variant="outline" disabled={!knownToken} onClick={() => knownToken && void copyLink(knownToken)}><Copy className="mr-1 h-3.5 w-3.5" />{t('copy')}</Button><Button size="sm" variant="outline" onClick={() => revokeGrant.mutate(grant.grant_id)} disabled={!active || revokeGrant.isPending}><Link2Off className="mr-1 h-3.5 w-3.5" />{t('disable')}</Button></div></div>;
              })}</div></ScrollArea>
            ) : <p className="text-sm text-muted-foreground">{t('noLinks')}</p>}
          </div>
          <Separator />
          <div className="space-y-3"><h3 className="font-semibold">{t('quickShare')}</h3><div className="grid gap-3 sm:grid-cols-2"><Button variant="outline" onClick={() => void shareCreatedLink()} disabled={!created}><MessageCircle className="mr-2 h-4 w-4 text-green-600" />{t('shareWechat')}</Button><Button variant="outline" onClick={() => created && window.open(`https://service.weibo.com/share/share.php?url=${encodeURIComponent(absoluteShareUrl(created.token, locale))}&title=${encodeURIComponent(scoreTitle)}`, '_blank', 'noopener,noreferrer')} disabled={!created}><Send className="mr-2 h-4 w-4 text-red-500" />{t('shareWeibo')}</Button></div></div>
          <DialogFooter><DialogClose asChild><Button variant="outline">{t('close')}</Button></DialogClose></DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
