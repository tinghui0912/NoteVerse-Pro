'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { libraryApi, myScoresApi, publicationsApi, scoresApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import type { MyScoresSort, MyScoresView } from '@/generated/api';

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

export function useAddMyScoresToLibrary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scoreIds: string[]) => libraryApi.batchAddOwned({ score_ids: scoreIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.myScores.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
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
