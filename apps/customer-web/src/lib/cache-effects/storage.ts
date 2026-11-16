import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-client';

export function storageUsageChanged(client: QueryClient) {
  return client.invalidateQueries({ queryKey: queryKeys.storageUsage.all });
}
