'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChangePasswordRequest, RequestEmailChangeRequest } from '@/generated/api';
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
    mutationFn: ({currentPassword, newPassword, locale}: {currentPassword: string; newPassword: string; locale: NonNullable<ChangePasswordRequest['locale']>}) =>
      accountSecurityApi.changePassword(currentPassword, newPassword, locale),
    onSuccess: () => accountPasswordChanged(client),
  });
}

export function useRequestEmailChange() {
  return useMutation({ mutationFn: (data: RequestEmailChangeRequest) => accountSecurityApi.requestEmailChange(data) });
}
