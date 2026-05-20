'use client';

import React, { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { queryClient } from '@/lib/query-client';
import { AuthProvider } from '@/contexts/auth-context';
import PillNav from '@/components/layout/pill-nav';
import { Toaster } from '@/components/ui/toaster';
import { ClientOnly } from '@/components/client-only';

export function ClientProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ClientOnly>
          <PillNav />
        </ClientOnly>
        {children}
        <Toaster />
      </AuthProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
