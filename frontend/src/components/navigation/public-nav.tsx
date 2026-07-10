
'use client';

import { useTranslations } from 'next-intl';
import { usePathname, Link } from '@/i18n/routing';
import { cn } from '@/lib/utils';
import {
  Menu,
  Music2,
  X,
} from 'lucide-react';
import React, { useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { ClientOnly } from '@/components/client-only';
import { LanguageSwitcher, NotificationBell, UserMenu } from '@/components/navigation/nav-actions';

export function PublicNav() {
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
    <header className="sticky left-0 right-0 top-0 z-50 border-b border-gray-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link href='/' className="flex items-center space-x-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-orange-500 text-white">
            <Music2 className="h-5 w-5" />
          </div>
          <span className="hidden text-lg font-semibold tracking-tight text-gray-950 sm:block">NoteVerse Pro</span>
        </Link>

        <ClientOnly>
          <>
            {/* Desktop Navigation */}
            <nav className="hidden items-center space-x-1 md:flex">
              {navItems.map((item) => {
                const isActive = (item.href === '/' && pathname === '/') || (item.href !== '/' && pathname.startsWith(item.href));

                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    className={cn(
                      "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? 'bg-orange-50 text-orange-700'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-950'
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
                <div className="hidden h-10 w-10 rounded-full bg-gray-100 md:block" />
              ) : isAuthenticated ? (
                <>
                  <NotificationBell buttonClassName="text-gray-600 hover:bg-gray-100 hover:text-gray-950" />
                  <UserMenu triggerClassName="hover:bg-gray-100" />
                </>
              ) : (
                <Link
                  href="/auth/login"
                  className="hidden rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 hover:text-gray-950 md:block"
                >
                  {t('nav.login')}
                </Link>
              )}
              <LanguageSwitcher buttonClassName="text-gray-600 hover:bg-gray-100 hover:text-gray-950" />

              {/* Mobile Menu Button */}
              <div className="md:hidden">
                <button
                  onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                  className="rounded-full p-2 text-gray-600 hover:bg-gray-100 hover:text-gray-950"
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
            <div className="mx-4 mt-2 rounded-lg border border-gray-200 bg-white p-3 shadow-lg md:hidden">
              <nav className="flex flex-col space-y-2">
                {navItems.map((item) => {
                  const isActive = (item.href === '/' && pathname === '/') || (item.href !== '/' && pathname.startsWith(item.href));
                  return (
                    <Link
                      key={item.label}
                      href={item.href}
                      className={cn(
                        "px-4 py-3 rounded-lg transition-colors text-base",
                        isActive ? 'bg-orange-50 text-orange-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-950'
                      )}
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      {t(item.label)}
                    </Link>
                  );
                })}
                {!isLoading && !isAuthenticated && (
                  <Link href="/auth/login" className="mt-2 rounded-md bg-orange-500 px-5 py-2.5 text-center font-medium text-white transition-colors hover:bg-orange-600">
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
