'use client';

import { useLocale, useTranslations } from 'next-intl';
import { MailPlus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useRouter } from '@/i18n/routing';
import { useToast } from '@/hooks/use-toast';
import {
  useAcceptMyPendingScoreInvite,
  useDeclineMyPendingScoreInvite,
  useMyPendingScoreInvites,
} from '@/hooks/queries/use-score-queries';
import { formatApiDateTime } from '@/lib/score/metadata-display';
import type { PendingScoreInvite } from '@/types/api';

interface PendingInvitesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PendingInvitesDialog({ open, onOpenChange }: PendingInvitesDialogProps) {
  const t = useTranslations('scoreCollaboration');
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();
  const invitesQuery = useMyPendingScoreInvites(open);
  const acceptInvite = useAcceptMyPendingScoreInvite();
  const declineInvite = useDeclineMyPendingScoreInvite();
  const invites = invitesQuery.data?.data ?? [];

  const handleAccept = (invite: PendingScoreInvite) => {
    acceptInvite.mutate(invite.invite_id, {
      onSuccess: (response) => {
        toast({ title: t('accepted'), description: t('acceptedDescription') });
        onOpenChange(false);
        router.push(`/score/${response.data?.score_id ?? invite.score_id}`);
      },
      onError: () => {
        toast({
          title: t('acceptFailed'),
          description: t('acceptFailedDescription'),
          variant: 'destructive',
        });
      },
    });
  };

  const handleDecline = (invite: PendingScoreInvite) => {
    declineInvite.mutate(invite.invite_id, {
      onSuccess: () => toast({ title: t('declined'), description: t('declinedDescription') }),
      onError: () => {
        toast({
          title: t('declineFailed'),
          description: t('declineFailedDescription'),
          variant: 'destructive',
        });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('myInvitesTitle')}</DialogTitle>
          <DialogDescription>{t('myInvitesDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {invitesQuery.isLoading ? (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              {t('loadingInvites')}
            </div>
          ) : invites.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              {t('noPendingPersonalInvites')}
            </div>
          ) : (
            invites.map((invite) => {
              const inviterName =
                invite.inviter?.display_name || invite.inviter?.email || t('unknownInviter');
              return (
                <div
                  key={invite.invite_id}
                  className="rounded-lg border p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold">{invite.score_title}</div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {t('personalInviteFrom', { name: inviterName })}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">
                          {invite.role === 'EDITOR' ? t('editor') : t('viewer')}
                        </Badge>
                        {invite.expires_at ? (
                          <span className="text-xs text-muted-foreground">
                            {t('expiresAt')}: {formatApiDateTime(invite.expires_at, locale)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <MailPlus className="mt-1 h-5 w-5 shrink-0 text-orange-500" />
                  </div>
                  <div className="mt-4 flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleDecline(invite)}
                      disabled={declineInvite.isPending}
                    >
                      {t('declineInvite')}
                    </Button>
                    <Button
                      type="button"
                      onClick={() => handleAccept(invite)}
                      disabled={acceptInvite.isPending}
                    >
                      {t('acceptInvite')}
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
