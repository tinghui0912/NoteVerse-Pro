'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/contexts/auth-context';
import { createRealtimeEventSource } from '@/lib/realtime/event-source';
import {
  parseRealtimeChange,
  parseRealtimeCheckpoint,
  parseRealtimeResyncRequired,
} from '@/lib/realtime/generated/events';
import { applyRealtimeCacheChange, serverStateResyncRequired } from '@/lib/cache-effects/realtime';

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (isLoading || !isAuthenticated) {
      return undefined;
    }

    const source = createRealtimeEventSource();

    const listener = (message: MessageEvent<string>) => {
      const change = parseRealtimeChange(message.data);
      if (change) void applyRealtimeCacheChange(queryClient, change);
      else void serverStateResyncRequired(queryClient);
    };
    source.addEventListener('checkpoint', (message: MessageEvent<string>) => {
      if (!parseRealtimeCheckpoint(message.data)) void serverStateResyncRequired(queryClient);
    });
    source.addEventListener('change', listener);
    source.addEventListener('resync-required', (message: MessageEvent<string>) => {
      parseRealtimeResyncRequired(message.data);
      void serverStateResyncRequired(queryClient);
    });

    return () => {
      source.close();
    };
  }, [isAuthenticated, isLoading, queryClient]);

  return children;
}
