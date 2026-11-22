import type { QueryClient } from '@tanstack/react-query';
import { accountQueryKeys } from '@/features/account/query-keys';

export function accountSecurityChanged(client: QueryClient) {
  return client.invalidateQueries({ queryKey: accountQueryKeys.security() });
}

export function accountSessionsChanged(client: QueryClient) {
  return client.invalidateQueries({ queryKey: accountQueryKeys.sessions() });
}

export async function accountPasswordChanged(client: QueryClient) {
  await Promise.all([accountSecurityChanged(client), accountSessionsChanged(client)]);
}
