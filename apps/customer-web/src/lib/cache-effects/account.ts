import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-client';

export function accountSessionsChanged(client: QueryClient) {
  return client.invalidateQueries({ queryKey: queryKeys.account.sessions() });
}
