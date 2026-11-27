'use client';
import { scoreLocation } from '@/features/scores/routes';

import { membershipRoleTranslationKey } from '@/features/scores/collaboration/roles';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Bell, Check, MailPlus, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/states';
import { InlineLoading } from '@/components/loading';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SectionErrorState } from '@/components/states';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useRouter } from '@/i18n/routing';
import { useToast } from '@/hooks/use-toast';
import { groupNotificationsByDate } from '@/features/notifications/date-groups';
import { useAcceptMyPendingScoreInvite, useDeclineMyPendingScoreInvite, useMyPendingScoreInvites } from '@/features/scores/collaboration/queries';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useMyNotifications,
  useNotificationUnreadCount,
} from '@/features/notifications/queries';
import { formatApiDateTime } from '@/lib/date-time';
import { userFacingErrorMessage } from '@/lib/i18n/error-message';
import { notificationHref } from '@/features/notifications/target';
import { notificationPresentation } from '@/features/notifications/presentation';
import type { NotificationRead, PendingInviteRead } from '@/generated/api';

interface NotificationCenterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NotificationCenterDialog({ open, onOpenChange }: NotificationCenterDialogProps) {
  const t = useTranslations('notifications');
  const collaborationT = useTranslations('scoreCollaboration');
  const errors = useTranslations('errors');
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();
  const [updateFilter, setUpdateFilter] = useState<'all' | 'unread'>('all');

  const pendingInvitesQuery = useMyPendingScoreInvites(open);
  const notificationsQuery = useMyNotifications(open);
  const unreadCountQuery = useNotificationUnreadCount(open);
  const acceptInvite = useAcceptMyPendingScoreInvite();
  const declineInvite = useDeclineMyPendingScoreInvite();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const invites = pendingInvitesQuery.data?.pages.flatMap((page) => page?.items ?? []) ?? [];
  const notifications = notificationsQuery.data?.pages.flatMap(page => page.items) ?? [];
  const unreadCount = unreadCountQuery.data?.count ?? 0;
  const visibleNotifications =
    updateFilter === 'unread'
      ? notifications.filter((notification) => !notification.read_at)
      : notifications;
  const groupedVisibleNotifications = groupNotificationsByDate(visibleNotifications);

  const handleAccept = (invite: PendingInviteRead) => {
    acceptInvite.mutate(invite.invite_id, {
      onSuccess: (response) => {
        toast({ title: t('accepted'), description: t('acceptedDescription') });
        onOpenChange(false);
        router.push(scoreLocation(response?.score_id ?? invite.score_id));
      },
      onError: (error) => {
        toast({
          title: t('acceptFailed'),
          description: userFacingErrorMessage(errors, error, t('acceptFailedDescription')),
          variant: 'destructive',
        });
      },
    });
  };

  const handleDecline = (invite: PendingInviteRead) => {
    declineInvite.mutate(invite.invite_id, {
      onSuccess: () => {
        toast({ title: t('declined'), description: t('declinedDescription') });
      },
      onError: (error) => {
        toast({
          title: t('declineFailed'),
          description: userFacingErrorMessage(errors, error, t('declineFailedDescription')),
          variant: 'destructive',
        });
      },
    });
  };

  const handleOpenNotification = (notification: NotificationRead) => {
    const openTarget = () => {
      const href = notificationHref(notification);
      if (href) {
        onOpenChange(false);
        router.push(href);
      }
    };

    if (notification.read_at) {
      openTarget();
      return;
    }

    markRead.mutate(notification.notification_id, {
      onSettled: openTarget,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh]">
          <div className="space-y-6 px-6 pb-6 pt-2">
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-muted-foreground">
                  {t('actionRequired')}
                </h3>
                {invites.length > 0 ? <Badge variant="secondary">{invites.length}</Badge> : null}
              </div>
              {pendingInvitesQuery.isLoading ? (
                <EmptyState
                  title={t('loading')}
                  className="min-h-0 rounded-lg border border-dashed p-5"
                />
              ) : pendingInvitesQuery.isError && !invites.length ? (
                <SectionErrorState
                  description={t('loadActionsFailed')}
                  retryLabel={t('retry')}
                  onRetry={() => void pendingInvitesQuery.refetch()}
                />
              ) : invites.length === 0 ? (
                <EmptyState
                  title={t('emptyActions')}
                  className="min-h-0 rounded-lg border border-dashed p-5"
                />
              ) : (
                <div className="space-y-3">
                  {invites.map((invite) => {
                    const inviterName =
                      invite.inviter?.display_name ||
                      invite.inviter?.email ||
                      collaborationT('unknownInviter');
                    return (
                      <div key={invite.invite_id} className="rounded-lg border p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-base font-semibold">
                              {invite.score_display_title}
                            </div>
                            <div className="mt-1 text-sm text-muted-foreground">
                              {collaborationT('personalInviteFrom', {
                                name: inviterName,
                              })}
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <Badge variant="secondary">
                                {collaborationT(membershipRoleTranslationKey[invite.role])}
                              </Badge>
                              {invite.expires_at ? (
                                <span className="text-xs text-muted-foreground">
                                  {collaborationT('expiresAt')}:{' '}
                                  {formatApiDateTime(invite.expires_at, locale)}
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
                            <X className="mr-2 h-4 w-4" />
                            {collaborationT('declineInvite')}
                          </Button>
                          <Button
                            type="button"
                            onClick={() => handleAccept(invite)}
                            disabled={acceptInvite.isPending}
                          >
                            <Check className="mr-2 h-4 w-4" />
                            {collaborationT('acceptInvite')}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {pendingInvitesQuery.hasNextPage ? (
                <Button
                  variant="outline"
                  disabled={pendingInvitesQuery.isFetchingNextPage}
                  onClick={() => void pendingInvitesQuery.fetchNextPage()}
                >
                  {pendingInvitesQuery.isFetchingNextPage ? <InlineLoading /> : null}
                  {collaborationT('loadMore')}
                </Button>
              ) : null}
            </section>

            <Separator />

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-muted-foreground">{t('updates')}</h3>
                <div className="flex items-center gap-2">
                  <div className="flex rounded-full border bg-muted/50 p-0.5">
                    <Button
                      type="button"
                      variant={updateFilter === 'all' ? 'secondary' : 'ghost'}
                      size="sm"
                      className="h-7 rounded-full px-3"
                      onClick={() => setUpdateFilter('all')}
                    >
                      {t('all')}
                    </Button>
                    <Button
                      type="button"
                      variant={updateFilter === 'unread' ? 'secondary' : 'ghost'}
                      size="sm"
                      className="h-7 rounded-full px-3"
                      onClick={() => setUpdateFilter('unread')}
                    >
                      {t('unreadOnly')}
                    </Button>
                  </div>
                  {unreadCount > 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => markAllRead.mutate()}
                      disabled={markAllRead.isPending}
                    >
                      {t('markAllRead')}
                    </Button>
                  ) : null}
                </div>
              </div>
              {notificationsQuery.isLoading ? (
                <EmptyState
                  title={t('loading')}
                  className="min-h-0 rounded-lg border border-dashed p-5"
                />
              ) : notificationsQuery.isError && !notifications.length ? (
                <SectionErrorState
                  description={t('loadUpdatesFailed')}
                  retryLabel={t('retry')}
                  onRetry={() => void notificationsQuery.refetch()}
                />
              ) : visibleNotifications.length === 0 ? (
                <EmptyState
                  title={t('emptyUpdates')}
                  className="min-h-0 rounded-lg border border-dashed p-5"
                />
              ) : (
                <div className="space-y-4">
                  {groupedVisibleNotifications.map((group) => (
                    <div key={group.key} className="space-y-2">
                      <div className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {t(`dateGroups.${group.key}`)}
                      </div>
                      {group.items.map((notification) => (
                        <button
                          key={notification.notification_id}
                          type="button"
                          className={cn(
                            'w-full rounded-lg border p-4 text-left transition-colors hover:bg-muted/60',
                            !notification.read_at && 'border-orange-200 bg-orange-50/60'
                          )}
                          onClick={() => handleOpenNotification(notification)}
                        >
                          <span className="flex items-start gap-3">
                            <span
                              className={cn(
                                'mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground',
                                !notification.read_at && 'bg-orange-100 text-orange-600'
                              )}
                            >
                              <Bell className="h-4 w-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold">
                                {notificationPresentation(notification, t).title}
                              </span>
                              <span className="mt-1 block truncate text-sm text-muted-foreground">
                                {notificationPresentation(notification, t).subtitle}
                              </span>
                              <span className="mt-2 block text-xs text-muted-foreground">
                                {formatApiDateTime(notification.created_at, locale)}
                              </span>
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              {notificationsQuery.isFetchNextPageError ? <p role="alert">{t('loadUpdatesFailed')}</p> : null}
              {notificationsQuery.hasNextPage ? (
                <Button type="button" variant="outline" disabled={notificationsQuery.isFetchingNextPage}
                  onClick={() => void notificationsQuery.fetchNextPage()}>
                  {notificationsQuery.isFetchingNextPage ? t('loading') : notificationsQuery.isFetchNextPageError ? t('retry') : t('loadMore')}
                </Button>
              ) : null}
            </section>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
