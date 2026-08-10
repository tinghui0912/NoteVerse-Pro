import { apiClient, type ApiResponse } from '@/lib/api-client';
import type { StorageUsageRead } from '@/generated/api';

export const storageUsageApi = {
  current: (signal?: AbortSignal) =>
    apiClient.get<ApiResponse<StorageUsageRead>>('/me/storage-usage', undefined, { signal }),
};
