'use client';

import type { ReactNode } from 'react';

import { BrandLogo } from '@/components/brand';
import { AuthenticatedNavActions } from '@/components/navigation';

export function WorkspaceShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="flex h-16 items-center justify-between px-4 sm:px-6">
          <BrandLogo href="/library" textClassName="hidden sm:block" />

          <div className="flex items-center gap-1">
            <AuthenticatedNavActions showNotifications />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
