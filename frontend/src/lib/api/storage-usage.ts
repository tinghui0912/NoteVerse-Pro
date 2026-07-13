import { apiClient, type ApiResponse } from '@/lib/api-client';
import type { StorageUsage } from '@/types/api';

export const storageUsageApi = {
  current: (signal?: AbortSignal) =>
    apiClient.get<ApiResponse<StorageUsage>>('/me/storage-usage', undefined, { signal }),
};
