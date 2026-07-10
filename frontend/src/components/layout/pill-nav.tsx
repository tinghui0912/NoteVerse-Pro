
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
import { ClientOnly } from '../client-only';
import { LanguageSwitcher, NotificationBell, UserMenu } from '@/components/layout/nav-actions';

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
                  href="/auth/login"
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
                  <Link href="/auth/login" className="bg-white text-black text-center font-medium mt-2 px-5 py-2.5 rounded-full hover:bg-gray-200 transition-colors">
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
