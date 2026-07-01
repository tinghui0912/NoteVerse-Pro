
'use client';

import { useTranslations, useLocale } from 'next-intl';
import { useRouter, usePathname, Link } from '@/i18n/routing';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  Bell,
  Check,
  Globe,
  Heart,
  LogOut,
  Menu,
  Music2,
  User,
  X,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Button } from '../ui/button';
import React, { useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { ClientOnly } from '../client-only';
import { useMyPendingScoreInvites } from '@/hooks/queries/use-score-queries';
import { PendingInvitesDialog } from '@/components/score-detail/pending-invites-dialog';

const UserMenu = () => {
  const { user, logout } = useAuth();
  const t = useTranslations('common');
  
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="relative h-10 w-10 rounded-full"
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
          <Link href="/profile">
            <User className="mr-2 h-4 w-4" />
            <span>{t('profile')}</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/subscriptions">
            <Heart className="mr-2 h-4 w-4" />
            <span>{t('subscriptions')}</span>
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
};

const NotificationBell = () => {
  const t = useTranslations('scoreCollaboration');
  const [isInvitesOpen, setIsInvitesOpen] = useState(false);
  const pendingInvites = useMyPendingScoreInvites(true);
  const pendingInviteCount = pendingInvites.data?.data?.length ?? 0;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t('myInvitesMenu')}
        className="relative rounded-full text-white hover:bg-white/20 hover:text-white"
        onClick={() => setIsInvitesOpen(true)}
      >
        <Bell className="h-5 w-5" />
        {pendingInviteCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1 text-[11px] font-semibold text-white">
            {pendingInviteCount}
          </span>
        ) : null}
      </Button>
      <PendingInvitesDialog open={isInvitesOpen} onOpenChange={setIsInvitesOpen} />
    </>
  );
};

const LanguageSwitcher = () => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const currentHref = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
  
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="text-white hover:bg-white/20 hover:text-white rounded-full">
          <Globe className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => router.replace(currentHref, { locale: 'zh' })}>
          <div className="flex items-center w-full justify-between">
            <span>中文</span>
            {locale === 'zh' && <Check className="h-4 w-4" />}
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.replace(currentHref, { locale: 'en' })}>
          <div className="flex items-center w-full justify-between">
            <span>English</span>
            {locale === 'en' && <Check className="h-4 w-4" />}
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default function PillNav() {
  const t = useTranslations('common');
  const pathname = usePathname();
  const { isAuthenticated, isLoading } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navItems = isAuthenticated
    ? [
      { label: 'nav.home' as const, href: '/' as const },
      { label: 'nav.upload' as const, href: '/upload' as const },
      { label: 'nav.myScores' as const, href: '/my-scores' as const },
      { label: 'nav.library' as const, href: '/library' as const },
      { label: 'nav.pricing' as const, href: '/subscriptions' as const },
      { label: 'nav.help' as const, href: '/help' as const },
    ]
    : [
      { label: 'nav.home' as const, href: '/' as const },
      { label: 'nav.pricing' as const, href: '/subscriptions' as const },
      { label: 'nav.help' as const, href: '/help' as const },
    ];




  return (
    <header className="absolute top-0 left-0 right-0 z-50 p-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between p-2 rounded-full bg-black/50 backdrop-blur-md border border-white/20">
        {/* Logo */}
        <Link href='/' className="flex items-center space-x-2 pl-2">
          <div className="w-8 h-8 rounded-full flex items-center justify-center bg-white">
            <Music2 className="w-5 h-5 text-orange-500" />
          </div>
          <span className="font-bold text-lg tracking-wide hidden sm:block text-white">NoteVerse Pro</span>
        </Link>

        <ClientOnly>
          <>
            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center space-x-2">
              {navItems.map((item) => {
                const isActive = (item.href === '/' && pathname === '/') || (item.href !== '/' && pathname.startsWith(item.href));

                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    className={cn(
                      "px-4 py-2 rounded-full text-sm font-medium transition-colors duration-300",
                      isActive
                        ? 'bg-white text-black'
                        : 'text-white hover:bg-white/20'
                    )}
                  >
                    {t(item.label)}
                  </Link>
                );
              })}
            </nav>

            {/* Right side actions */}
            <div className="flex items-center gap-1">
              {isLoading ? (
                <div className="hidden md:block h-10 w-10 rounded-full bg-white/20" />
              ) : isAuthenticated ? (
                <>
                  <NotificationBell />
                  <UserMenu />
                </>
              ) : (
                <Link
                  href="/login"
                  className="hidden md:block text-sm font-medium px-5 py-2.5 rounded-full transition-colors bg-white text-black hover:bg-gray-200"
                >
                  {t('nav.login')}
                </Link>
              )}
              <LanguageSwitcher />

              {/* Mobile Menu Button */}
              <div className="md:hidden">
                <button
                  onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                  className="p-2 text-white"
                >
                  {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
                </button>
              </div>
            </div>
          </>
        </ClientOnly>
      </div>

      <ClientOnly>
        <>
          {/* Mobile Menu */}
          {isMobileMenuOpen && (
            <div className="md:hidden mt-2 bg-black/90 backdrop-blur-lg rounded-xl p-4">
              <nav className="flex flex-col space-y-2">
                {navItems.map((item) => {
                  const isActive = (item.href === '/' && pathname === '/') || (item.href !== '/' && pathname.startsWith(item.href));
                  return (
                    <Link
                      key={item.label}
                      href={item.href}
                      className={cn(
                        "px-4 py-3 rounded-lg transition-colors text-base",
                        isActive ? 'bg-white text-black' : 'text-white/80 hover:bg-white/10'
                      )}
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      {t(item.label)}
                    </Link>
                  );
                })}
                {!isLoading && !isAuthenticated && (
                  <Link href="/login" className="bg-white text-black text-center font-medium mt-2 px-5 py-2.5 rounded-full hover:bg-gray-200 transition-colors">
                    {t('nav.login')}
                  </Link>
                )}
              </nav>
            </div>
          )}
        </>
      </ClientOnly>
    </header>
  );
}
