'use client';

import React, { ReactNode } from 'react';
import { AuthProvider } from '@/contexts/auth-context';
import PillNav from '@/components/layout/pill-nav';
import { Toaster } from '@/components/ui/toaster';
import { ClientOnly } from '@/components/client-only';

export function ClientProviders({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <ClientOnly>
        <PillNav />
      </ClientOnly>
      {children}
      <Toaster />
    </AuthProvider>
  );
}
