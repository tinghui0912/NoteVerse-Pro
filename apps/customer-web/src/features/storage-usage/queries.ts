'use client';

import { storageUsageQueryKeys } from '@/features/storage-usage/query-keys';

import { useQuery } from '@tanstack/react-query';

import { storageUsageApi } from './api';

export function useStorageUsage() {
  return useQuery({
    queryKey: storageUsageQueryKeys.current(),
    queryFn: ({ signal }) => storageUsageApi.current(signal),
  });
}
