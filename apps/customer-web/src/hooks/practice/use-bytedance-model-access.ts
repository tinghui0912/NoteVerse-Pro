'use client';

import { useQuery } from '@tanstack/react-query';

import { modelAssetsApi, type ModelAssetAccess } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';

export function useByteDanceModelAccess(enabled = true) {
  return useQuery<ModelAssetAccess>({
    queryKey: queryKeys.modelAssets.bytedanceNoteAccess(),
    queryFn: async ({ signal }) => {
      return modelAssetsApi.getByteDanceNoteModelAccess(signal);
    },
    enabled,
    staleTime: 50 * 60 * 1000, // 50 minutes (signed URLs expire in 60 minutes)
    gcTime: 60 * 60 * 1000,
    retry: 1,
  });
}
