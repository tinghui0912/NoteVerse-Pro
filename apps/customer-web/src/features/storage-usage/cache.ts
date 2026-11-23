import { storageUsageQueryKeys } from '@/features/storage-usage/query-keys';
import type { QueryClient } from '@tanstack/react-query';

export function storageUsageChanged(client: QueryClient) {
  return client.invalidateQueries({ queryKey: storageUsageQueryKeys.all });
}
