'use client';

import { useQuery } from '@tanstack/react-query';

import { storageUsageApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';

export function useStorageUsage() {
  return useQuery({
    queryKey: queryKeys.storageUsage.current(),
    queryFn: ({ signal }) => storageUsageApi.current(signal),
  });
}
