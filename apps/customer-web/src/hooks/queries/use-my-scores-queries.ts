'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { libraryApi, myScoresApi, scoresApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import type { MyScoresSort } from '@/generated/api';

export function useMyScores(params: {
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
