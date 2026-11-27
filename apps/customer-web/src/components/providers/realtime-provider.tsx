'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useAuthentication } from '@/features/authentication/session/authentication-context';
import { createRealtimeEventSource } from '@/lib/realtime/event-source';
import {
  parseRealtimeChange,
  parseRealtimeCheckpoint,
  parseRealtimeResyncRequired,
} from '@/lib/realtime/generated/events';
import { applyRealtimeCacheChange, serverStateResyncRequired } from '@/lib/cache-effects/realtime';

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, refreshPrincipal } = useAuthentication();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (isLoading || !isAuthenticated) {
      return undefined;
    }

    const source = createRealtimeEventSource();
    let checkingSession = false;
    let active = true;
    source.addEventListener('error', () => {
      if (checkingSession || !active) return;
      checkingSession = true;
      // EventSource does not expose HTTP status; a profile probe resolves session authority.
      void refreshPrincipal().then(valid => {
        if (valid === false && active) source.close();
      }, () => {
        // Transient failures retain native EventSource reconnect and cursor behavior.
      }).finally(() => { checkingSession = false; });
    });

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
      active = false;
      source.close();
    };
  }, [isAuthenticated, isLoading, queryClient, refreshPrincipal]);

  return children;
}
