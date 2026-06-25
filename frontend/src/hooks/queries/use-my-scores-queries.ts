'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { myScoresApi, publicationsApi, scoresApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import type { MyScoresSort, MyScoresView } from '@/types/api';

export function useMyScores(params: {
  view?: MyScoresView;
  search?: string;
  sort?: MyScoresSort;
  page: number;
  pageSize: number;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: queryKeys.myScores.list(params),
    queryFn: ({ signal }) =>
      myScoresApi.list(
        {
          view: params.view,
          search: params.search || undefined,
          sort: params.sort,
          page: params.page,
          page_size: params.pageSize,
        },
        signal
      ),
    enabled: params.enabled ?? true,
  });
}

export function useDeleteMyScores() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scoreIds: string[]) => scoresApi.batchDelete(scoreIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.myScores.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.scores.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
    },
  });
}

export function useArchiveMyScores() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scoreIds: string[]) => scoresApi.batchArchive(scoreIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.myScores.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.scores.all });
    },
  });
}

export function useRestoreMyScores() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scoreIds: string[]) => scoresApi.batchRestore(scoreIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.myScores.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.scores.all });
    },
  });
}

export function usePublishMyScores() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (scoreIds: string[]) => {
      await Promise.all(
        scoreIds.map((scoreId) =>
          publicationsApi.publish(scoreId, {
            discoverability: 'LISTED',
            allow_download: false,
            allow_practice: true,
          })
        )
      );
      return { published: scoreIds.length };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.myScores.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.scores.all });
    },
  });
}

export function useUnpublishMyScores() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (scoreIds: string[]) => {
      await Promise.all(scoreIds.map((scoreId) => publicationsApi.unpublish(scoreId)));
      return { unpublished: scoreIds.length };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.myScores.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.scores.all });
    },
  });
}
