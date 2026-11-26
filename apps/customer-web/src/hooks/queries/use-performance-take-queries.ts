'use client';
import { uploadSession, type UploadSessionOptions } from '@/lib/upload/upload-session-client';
import { PerformanceTakeSaveCommand } from '@/lib/practice/performance-take/save-command';
import type { SavePerformanceTakeInput } from '@/lib/practice/performance-take/save';

import { useMutation, useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';

import { performanceTakeDeleted, performanceTakeSaved } from '@/lib/cache-effects/performance-takes';
import {
performanceTakesApi
} from '@/lib/api/performance-takes';
import type { PerformanceTakesListData } from '@/generated/api';
import { queryKeys } from '@/lib/query-client';

export function usePerformanceTakes(
  params?: Omit<NonNullable<PerformanceTakesListData['query']>, 'cursor'>,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: queryKeys.performanceTakes.list(params),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) => performanceTakesApi.listTakes({ ...params, cursor: pageParam }, signal),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    refetchInterval: query => query.state.data?.pages.some(page => page.items.some(take => take.media_status === 'UPLOADED' || take.media_status === 'PROCESSING')) ? 2000 : false,
    enabled,
  });
}

export function usePerformanceTakeDetail(takeId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.performanceTakes.detail(takeId),
    queryFn: ({ signal }) => performanceTakesApi.getTake(takeId, signal),
    enabled: enabled && Boolean(takeId),
    refetchInterval: query => query.state.data?.media_status === 'UPLOADED' || query.state.data?.media_status === 'PROCESSING' ? 2000 : false,
  });
}

export function usePerformanceTakePlayback(takeId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.performanceTakes.playbackUrl(takeId),
    queryFn: ({ signal }) => performanceTakesApi.getPlaybackUrl(takeId, signal),
    enabled: enabled && Boolean(takeId),
    gcTime: 0,
    staleTime: 0,
    refetchInterval: query => query.state.data ? Math.max(1000,(query.state.data.expires_in-30)*1000) : false,
  });
}

export function useDeletePerformanceTake() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (takeId: string) => performanceTakesApi.deleteTake(takeId),
    onSuccess: (_response, takeId) => performanceTakeDeleted(queryClient, takeId),
  });
}

export function useSavePerformanceTake() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (command: PerformanceTakeSaveCommand) => command.execute(),
    onSuccess: () => performanceTakeSaved(queryClient),
  });
  return {
    async mutateAsync(input: SavePerformanceTakeInput, options?: Pick<UploadSessionOptions, 'signal' | 'onProgress'>) {
      const command = new PerformanceTakeSaveCommand(input, performanceTakesApi, uploadSession, options);
      try {
        return await mutation.mutateAsync(command);
      } finally {
        await command.release();
      }
    },
  };
}
