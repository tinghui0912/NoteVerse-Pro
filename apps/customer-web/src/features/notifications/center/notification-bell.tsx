'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useMyPendingScoreInvites } from '@/features/scores/collaboration/queries';
import { useNotificationUnreadCount } from '../queries';
import { NotificationCenterDialog } from './notification-center-dialog';

export function NotificationBell({ buttonClassName }: { buttonClassName?: string }) {
  const t = useTranslations('notifications');
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const pendingInvites = useMyPendingScoreInvites(true);
  const unreadNotifications = useNotificationUnreadCount(true);
  const pendingInviteCount =
    pendingInvites.data?.pages.reduce(
      (count, page) => count + (page?.items.length ?? 0),
      0
    ) ?? 0;
  const unreadNotificationCount = unreadNotifications.data?.count ?? 0;
  const badgeCount = (pendingInvites.hasNextPage ? Math.max(100, pendingInviteCount) : pendingInviteCount) + unreadNotificationCount;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t('bellLabel')}
        className={cn(
          'relative rounded-full',
          buttonClassName ?? 'text-white hover:bg-white/20 hover:text-white'
        )}
        onClick={() => setIsNotificationsOpen(true)}
      >
        <Bell className="h-5 w-5" />
        {badgeCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1 text-[11px] font-semibold text-white">
            {badgeCount > 99 ? '99+' : badgeCount}
          </span>
        ) : null}
      </Button>
      <NotificationCenterDialog open={isNotificationsOpen} onOpenChange={setIsNotificationsOpen} />
    </>
  );
}
