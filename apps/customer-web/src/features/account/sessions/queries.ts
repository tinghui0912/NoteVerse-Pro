'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { accountSessionsChanged } from '../cache';
import { accountQueryKeys } from '../query-keys';
import { accountSessionsApi } from './api';

export function useAccountSessions() {
  return useQuery({
    queryKey: accountQueryKeys.sessions(),
    queryFn: ({ signal }) => accountSessionsApi.getSessions(signal),
  });
}

export function useRevokeSession() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: number) => accountSessionsApi.revokeSession(sessionId),
    onSuccess: () => accountSessionsChanged(client),
  });
}

export function useRevokeOtherSessions() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => accountSessionsApi.revokeOtherSessions(),
    onSuccess: () => accountSessionsChanged(client),
  });
}
