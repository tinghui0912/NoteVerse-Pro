'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Check, Globe, LayoutDashboard, LogOut, Settings, User } from 'lucide-react';

import { NotificationBell } from '@/features/notifications/center/notification-bell';
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
import { useAuthentication } from '@/features/authentication/session/authentication-context';
import { Link, usePathname, useRouter } from '@/i18n/routing';
import { cn } from '@/lib/utils';

export function UserMenu({ triggerClassName }: { triggerClassName?: string }) {
  const { principal, logout } = useAuthentication();
  const t = useTranslations('common');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className={cn('relative h-10 w-10 rounded-full', triggerClassName)}>
          <Avatar className="h-9 w-9">
            <AvatarImage src={principal?.avatar_url || undefined} alt={principal?.display_name || ''} />
            <AvatarFallback>
              <User className="h-5 w-5" />
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{principal?.display_name}</p>
            <p className="text-xs leading-none text-muted-foreground">{t('premiumUser')}</p>
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

function ReturnToAppButton({ className }: { className?: string }) {
  const t = useTranslations('common');

  return (
    <Button asChild variant="outline" className={cn('hidden sm:inline-flex', className)}>
      <Link href="/library">
        <LayoutDashboard className="h-4 w-4" />
        {t('returnToApp')}
      </Link>
    </Button>
  );
}

export function AuthenticatedNavActions({
  showNotifications = false,
}: {
  showNotifications?: boolean;
}) {
  return (
    <>
      <ReturnToAppButton />
      {showNotifications ? (
        <NotificationBell buttonClassName="text-gray-600 hover:bg-gray-100 hover:text-gray-950" />
      ) : null}
      <LanguageSwitcher buttonClassName="text-gray-600 hover:bg-gray-100 hover:text-gray-950" />
      <UserMenu triggerClassName="hover:bg-gray-100" />
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
          className={cn(
            'rounded-full',
            buttonClassName ?? 'text-white hover:bg-white/20 hover:text-white'
          )}
        >
          <Globe className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => router.replace(currentHref, { locale: 'zh' })}>
          <div className="flex w-full items-center justify-between">
            <span>中文</span>
            {locale === 'zh' ? <Check className="h-4 w-4" /> : null}
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.replace(currentHref, { locale: 'en' })}>
          <div className="flex w-full items-center justify-between">
            <span>English</span>
            {locale === 'en' ? <Check className="h-4 w-4" /> : null}
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
