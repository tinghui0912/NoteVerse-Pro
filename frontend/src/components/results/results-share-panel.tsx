'use client';

import { useMemo, useState } from 'react';
import { Copy, Link as LinkIcon, Link2Off, Loader2, MoreVertical, Trash2, Undo } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useCreateShare, useDeleteShare, useShareList, useToggleShare } from '@/hooks/queries/use-share-queries';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { Share } from '@/types/api';
import {
  getResultsShareStatus,
  getShareExpirationDays,
  type ResultsShareStatus,
} from '@/lib/results/share';

interface ShareItem {
  id: string;
  url: string;
  date: string;
  status: ResultsShareStatus;
  expires: string;
  token: string;
}

const statusConfig: Record<ResultsShareStatus, { labelKey: string; icon: React.ElementType }> = {
  active: { labelKey: 'statusActive', icon: LinkIcon },
  revoked: { labelKey: 'statusRevoked', icon: Link2Off },
  expired: { labelKey: 'statusExpired', icon: Link2Off },
};

export function ResultsSharePanel({ taskId }: { taskId: string }) {
  const t = useTranslations('results');
  const shareText = useTranslations('share');
  const history = useTranslations('history');
  const errors = useTranslations('errors');
  const common = useTranslations('common');
  const { toast } = useToast();
  const [expiration, setExpiration] = useState('7d');
  const sharesQuery = useShareList(taskId);
  const createShare = useCreateShare(taskId);
  const toggleShare = useToggleShare(taskId);
  const deleteShare = useDeleteShare(taskId);
  const shares = useMemo<ShareItem[]>(() => (sharesQuery.data?.data?.shares ?? []).map((item: Share) => ({
    id: String(item.id),
    url: `/share/${item.share_token}`,
    date: item.created_at || '',
    status: getResultsShareStatus(item),
    expires: item.expires_at || '',
    token: item.share_token,
  })), [sharesQuery.data]);

  const copy = (url?: string, message?: string) => {
    if (!url) {
      toast({ title: t('copyFailed'), description: t('linkUnavailable'), variant: 'destructive' });
      return;
    }
    void navigator.clipboard.writeText(url.startsWith('/') ? `${window.location.origin}${url}` : url);
    toast({ title: common('copied'), description: message });
  };

  const create = () => {
    createShare.mutate(
      { expiresInDays: getShareExpirationDays(expiration) },
      {
        onSuccess: (response) => {
          toast({ title: t('createShareSuccess'), description: t('shareLinkCreated') });
          if (response.data) void navigator.clipboard.writeText(`${window.location.origin}/share/${response.data.share_token}`);
        },
        onError: (error) => toast({
          title: t('createShareFailed'),
          description: error instanceof ApiError && error.code ? errors(error.code as never) : t('createShareFailedDesc'),
          variant: 'destructive',
        }),
      }
    );
  };

  const act = (item: ShareItem, action: 'toggle' | 'delete') => {
    if (action === 'delete') {
      deleteShare.mutate(item.token, {
        onSuccess: () => toast({ title: t('deleteShareSuccess'), description: t('shareLinkDeleted') }),
        onError: (error) => toast({ title: t('operationFailed'), description: error instanceof ApiError ? error.message : t('operationFailed'), variant: 'destructive' }),
      });
      return;
    }
    toggleShare.mutate(item.token, {
      onSuccess: (response) => response.data && toast({
        title: response.data.revoked ? t('revoked') : t('reinstated'),
        description: response.data.revoked ? t('shareLinkRevoked') : t('shareLinkReinstated'),
      }),
      onError: (error) => toast({ title: t('operationFailed'), description: error instanceof ApiError ? error.message : t('operationFailed'), variant: 'destructive' }),
    });
  };

  return (
    <>
      <Card className="rounded-2xl bg-white shadow-lg">
        <CardHeader><CardTitle>{shareText('createShare')}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="share-expiration">{shareText('expiration')}</Label>
            <Select value={expiration} onValueChange={setExpiration}>
              <SelectTrigger id="share-expiration" className="bg-white"><SelectValue placeholder={t('selectExpirationPlaceholder')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1d">{shareText('1day')}</SelectItem><SelectItem value="7d">{shareText('7days')}</SelectItem>
                <SelectItem value="30d">{shareText('30days')}</SelectItem><SelectItem value="365d">{shareText('365days')}</SelectItem>
                <SelectItem value="perm">{shareText('permanent')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button className="w-full rounded-full" onClick={create} disabled={createShare.isPending}>
            {createShare.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : shareText('createLink')}
          </Button>
        </CardContent>
      </Card>

      <Card className="rounded-2xl bg-white shadow-lg">
        <CardHeader><CardTitle>{shareText('historicalShares')}</CardTitle></CardHeader>
        <CardContent>
          <ScrollArea className="h-72 w-full">
            <div className="space-y-3 pr-4">
              {shares.length ? shares.map((item) => {
                const config = statusConfig[item.status];
                const active = item.status === 'active';
                return (
                  <div key={item.id} className={cn('flex items-start rounded-lg border p-3 transition-opacity', active ? 'border-orange-200 bg-orange-50' : 'border-border bg-secondary opacity-60')}>
                    <config.icon className={cn('mr-3 mt-0.5 h-5 w-5 shrink-0', active ? 'text-orange-500' : 'text-muted-foreground')} />
                    <div className="flex-1 space-y-1 overflow-hidden text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <p className={cn('font-medium', active ? 'text-orange-600' : 'text-muted-foreground')}>{shareText('viewOnly')}</p>
                        <Badge variant="outline" className={cn('shrink-0', active ? 'border-orange-300 text-orange-600' : 'border-border text-muted-foreground')}>{history(config.labelKey as never)}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{history('createdAt')}: {item.date}</p>
                      <p className="text-xs text-muted-foreground">{history('expiresAt')}: {item.expires}</p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="-mr-1.5 -mt-1.5 h-8 w-8 shrink-0"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => copy(item.url, `${shareText('copyShareLink')} (${item.date})`)}><Copy className="mr-2 h-4 w-4" />{shareText('copyLink')}</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {item.status !== 'expired' && <DropdownMenuItem onClick={() => act(item, 'toggle')}>{active ? <Link2Off className="mr-2 h-4 w-4" /> : <Undo className="mr-2 h-4 w-4" />}{active ? shareText('revoke') : shareText('reinstate')}</DropdownMenuItem>}
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => act(item, 'delete')}><Trash2 className="mr-2 h-4 w-4" />{history('deleteRecord')}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              }) : <p className="py-4 text-center text-sm text-muted-foreground">{t('noHistoricalShares')}</p>}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </>
  );
}
