'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Bell, Check, Globe, LogOut, Settings, User } from 'lucide-react';

import { NotificationCenterDialog } from '@/components/notifications/notification-center-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/auth-context';
import { Link, usePathname, useRouter } from '@/i18n/routing';
import { useMyPendingScoreInvites } from '@/hooks/queries/use-score-queries';
import { useNotificationUnreadCount } from '@/hooks/queries/use-notification-queries';
import { cn } from '@/lib/utils';

export function UserMenu({ triggerClassName }: { triggerClassName?: string }) {
  const { user, logout } = useAuth();
  const t = useTranslations('common');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn('relative h-10 w-10 rounded-full', triggerClassName)}
        >
          <Avatar className="h-9 w-9">
            <AvatarImage
              src={user?.avatar || undefined}
              alt={user?.name || ''}
            />
            <AvatarFallback>
              <User className="h-5 w-5" />
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{user?.name}</p>
            <p className="text-xs leading-none text-muted-foreground">
              {t('premiumUser')}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/profile">
            <Settings className="mr-2 h-4 w-4" />
            <span>{t('settings')}</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={logout}>
          <LogOut className="mr-2 h-4 w-4" />
          <span>{t('logout')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function NotificationBell({ buttonClassName }: { buttonClassName?: string }) {
  const t = useTranslations('notifications');
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const pendingInvites = useMyPendingScoreInvites(true);
  const unreadNotifications = useNotificationUnreadCount(true);
  const pendingInviteCount = pendingInvites.data?.data?.length ?? 0;
  const unreadNotificationCount = unreadNotifications.data?.data?.count ?? 0;
  const badgeCount = pendingInviteCount + unreadNotificationCount;

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
      <NotificationCenterDialog
        open={isNotificationsOpen}
        onOpenChange={setIsNotificationsOpen}
      />
    </>
  );
}

export function LanguageSwitcher({ buttonClassName }: { buttonClassName?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const currentHref = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('rounded-full', buttonClassName ?? 'text-white hover:bg-white/20 hover:text-white')}
        >
          <Globe className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => router.replace(currentHref, { locale: 'zh' })}>
          <div className="flex w-full items-center justify-between">
            <span>中文</span>
            {locale === 'zh' && <Check className="h-4 w-4" />}
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.replace(currentHref, { locale: 'en' })}>
          <div className="flex w-full items-center justify-between">
            <span>English</span>
            {locale === 'en' && <Check className="h-4 w-4" />}
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
