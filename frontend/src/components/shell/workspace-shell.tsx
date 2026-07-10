'use client';

import { Music2 } from 'lucide-react';
import type { ReactNode } from 'react';

import { Link } from '@/i18n/routing';
import { AuthenticatedNavActions } from '@/components/navigation/nav-actions';

export function WorkspaceShell({ children }: { children: ReactNode }) {
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
            <AuthenticatedNavActions showNotifications />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
