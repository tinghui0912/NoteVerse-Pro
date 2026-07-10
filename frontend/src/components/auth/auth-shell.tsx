'use client';

import { Music2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { LanguageSwitcher } from '@/components/layout/nav-actions';
import { Link } from '@/i18n/routing';

export function AuthShell({ children }: { children: React.ReactNode }) {
  const tCommon = useTranslations('common');

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 text-gray-950">
      <header className="border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="inline-flex items-center gap-2 text-base font-bold">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-orange-500 text-white">
              <Music2 className="h-5 w-5" />
            </span>
            <span>NoteVerse Pro</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="rounded-md px-3 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100 hover:text-gray-950"
            >
              {tCommon('returnHome')}
            </Link>
            <LanguageSwitcher buttonClassName="text-gray-600 hover:bg-gray-100 hover:text-gray-950" />
          </div>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
        {children}
      </main>

      <footer className="border-t border-gray-200 bg-white px-4 py-6 text-sm text-gray-500 sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-4 sm:flex-row">
          <p>© {new Date().getFullYear()} NoteVerse Pro. {tCommon('allRightsReserved')}</p>
          <div className="flex items-center gap-5">
            <a href="#" className="transition hover:text-gray-950">
              {tCommon('privacyPolicy')}
            </a>
            <a href="#" className="transition hover:text-gray-950">
              {tCommon('termsOfService')}
            </a>
            <Link href="/help" className="transition hover:text-gray-950">
              {tCommon('nav.help')}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
