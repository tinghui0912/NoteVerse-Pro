'use client';

import { useQuery } from '@tanstack/react-query';
import { myScoresApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import type { MyScoresSort, MyScoresView } from '@/types/api';

export function useMyScores(params: {
  view?: MyScoresView;
  search?: string;
  sort?: MyScoresSort;
  page: number;
  pageSize: number;
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
  });
}
