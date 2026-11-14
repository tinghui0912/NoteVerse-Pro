'use client';
import { uploadMediaToSignedUrl } from '@/lib/http/direct-object-upload';
import { PerformanceTakeSaveCommand } from '@/lib/practice/saved-take/save-command';
import type { SavePerformanceTakeInput } from '@/lib/practice/saved-take/save';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { PerformanceTakeGetResponse, PerformanceTakesListResponse } from '@/generated/api';
import {
performanceTakesApi
} from '@/lib/api/performance-takes';
import { queryKeys } from '@/lib/query-client';

export function usePerformanceTakes(
  params?: { score_id?: string; limit?: number; offset?: number },
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.performanceTakes.list(params),
    queryFn: ({ signal }) => performanceTakesApi.listTakes(params, signal),
    enabled,
  });
}

export function usePerformanceTakeDetail(takeId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.performanceTakes.detail(takeId),
    queryFn: ({ signal }) => performanceTakesApi.getTake(takeId, signal),
    enabled: enabled && Boolean(takeId),
  });
}

export function usePerformanceTakePlayback(takeId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.performanceTakes.playbackUrl(takeId),
    queryFn: ({ signal }) => performanceTakesApi.getPlaybackUrl(takeId, signal),
    enabled: enabled && Boolean(takeId),
  });
}

export function useDeletePerformanceTake() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (takeId: string) => performanceTakesApi.deleteTake(takeId),
    onSuccess: async (_response, takeId) => {
      await Promise.all([
        queryClient.cancelQueries({
          queryKey: queryKeys.performanceTakes.lists(),
        }),
        queryClient.cancelQueries({
          queryKey: queryKeys.performanceTakes.detail(takeId),
          exact: true,
        }),
        queryClient.cancelQueries({
          queryKey: queryKeys.performanceTakes.playbackUrl(takeId),
          exact: true,
        }),
      ]);
      const lists = queryClient.getQueriesData<
        PerformanceTakesListResponse
      >({
        queryKey: queryKeys.performanceTakes.lists(),
      });
      const take =
        queryClient.getQueryData<PerformanceTakeGetResponse>(
          queryKeys.performanceTakes.detail(takeId),
        ) ??
        lists
          .flatMap(([, value]) => value?.items ?? [])
          .find((item) => item.take_id === takeId);
      const matchingScoreFilters = new Set(
        lists.flatMap(([key, value]) => {
          const filter = (key[2] ?? {}) as { score_id?: string };
          return filter.score_id &&
            value?.items.some((item) => item.take_id === takeId)
            ? [filter.score_id]
            : [];
        }),
      );
      for (const [key] of lists) {
        const filter = (key[2] ?? {}) as { score_id?: string };
        const belongs =
          !filter.score_id ||
          filter.score_id === take?.linked_score_id ||
          matchingScoreFilters.has(filter.score_id);
        queryClient.setQueryData<PerformanceTakesListResponse>(
          key,
          (previous) => {
            if (!previous) return previous;
            const data = previous;
            const items = data.items.filter((item) => item.take_id !== takeId);
            const total = Math.max(
              0,
              data.total -
                (belongs || items.length !== data.items.length ? 1 : 0),
            );
            return {
                ...data,
                items,
                total,
                has_more: (data.offset ?? 0) + items.length < total,
            };
          },
        );
      }
      queryClient.removeQueries({
        queryKey: queryKeys.performanceTakes.detail(takeId),
        exact: true,
      });
      queryClient.removeQueries({
        queryKey: queryKeys.performanceTakes.playbackUrl(takeId),
        exact: true,
      });
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.performanceTakes.lists(),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.storageUsage.all }),
      ]);
    },
  });
}

export function useSavePerformanceTake() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (command: PerformanceTakeSaveCommand) => command.execute(),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.performanceTakes.all,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.storageUsage.all });
    },
  });
  return {
    async mutateAsync(input: SavePerformanceTakeInput) {
      const command = new PerformanceTakeSaveCommand(input, performanceTakesApi, uploadMediaToSignedUrl);
      try {
        return await mutation.mutateAsync(command);
      } finally {
        await command.release();
      }
    },
  };
}
