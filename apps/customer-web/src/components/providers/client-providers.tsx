'use client';

import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

import { AuthenticationProvider } from '@/features/authentication/session/authentication-context';
import { queryClient } from '@/lib/query-client';
import { Toaster } from '@/components/ui/toaster';
import { RealtimeProvider } from '@/components/providers/realtime-provider';

export function ClientProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthenticationProvider>
        <RealtimeProvider>{children}</RealtimeProvider>
        <Toaster />
      </AuthenticationProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
