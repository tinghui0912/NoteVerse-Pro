'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RequestEmailChangeRequest } from '@/generated/api';
import { accountPasswordChanged } from '../cache';
import { accountQueryKeys } from '../query-keys';
import { accountSecurityApi } from './api';

export function useAccountSecurity() {
  return useQuery({
    queryKey: accountQueryKeys.security(),
    queryFn: ({ signal }) => accountSecurityApi.getSecurityOverview(signal),
  });
}

export function useChangePassword() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({currentPassword, newPassword}: {currentPassword: string; newPassword: string}) =>
      accountSecurityApi.changePassword(currentPassword, newPassword),
    onSuccess: () => accountPasswordChanged(client),
  });
}

export function useRequestEmailChange() {
  return useMutation({ mutationFn: (data: RequestEmailChangeRequest) => accountSecurityApi.requestEmailChange(data) });
}
