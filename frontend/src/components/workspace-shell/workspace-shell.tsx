'use client';

import { LayoutDashboard, Music2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { LanguageSwitcher, NotificationBell, UserMenu } from '@/components/layout/nav-actions';

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const t = useTranslations('common');

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="flex h-16 items-center justify-between px-4 sm:px-6">
          <Link href="/library" className="flex min-w-0 items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-orange-500 text-white">
              <Music2 className="h-5 w-5" />
            </div>
            <span className="hidden truncate font-semibold tracking-tight text-gray-950 sm:block">
              NoteVerse Pro
            </span>
          </Link>

          <div className="flex items-center gap-1">
            <Button asChild variant="outline" className="hidden sm:inline-flex">
              <Link href="/library">
                <LayoutDashboard className="h-4 w-4" />
                {t('returnToApp')}
              </Link>
            </Button>
            <NotificationBell buttonClassName="text-gray-600 hover:bg-gray-100 hover:text-gray-950" />
            <LanguageSwitcher buttonClassName="text-gray-600 hover:bg-gray-100 hover:text-gray-950" />
            <UserMenu triggerClassName="hover:bg-gray-100" />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
