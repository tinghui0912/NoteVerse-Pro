'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { BrandLogo } from '@/components/brand';
import { AuthenticatedNavActions, LanguageSwitcher } from '@/components/navigation';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/auth-context';
import { Link } from '@/i18n/routing';

export function InviteShell({ children }: { children: ReactNode }) {
  const t = useTranslations('common');
  const { isAuthenticated, isLoading } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <BrandLogo />

          <div className="flex items-center gap-1">
            {isLoading ? (
              <div className="hidden h-10 w-10 rounded-full bg-gray-100 sm:block" />
            ) : isAuthenticated ? (
              <AuthenticatedNavActions showNotifications />
            ) : (
              <>
                <Button asChild variant="ghost" className="hidden sm:inline-flex">
                  <Link href="/auth/login">{t('nav.login')}</Link>
                </Button>
                <LanguageSwitcher buttonClassName="text-gray-600 hover:bg-gray-100 hover:text-gray-950" />
              </>
            )}
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
