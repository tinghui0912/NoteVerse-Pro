import { apiClient } from '@/lib/api-client';
import type { MyScore, MyScoresSort, MyScoresView, PaginatedResponse } from '@/types/api';

export const myScoresApi = {
  list: (
    params: {
      view?: MyScoresView;
      search?: string;
      sort?: MyScoresSort;
      page: number;
      page_size: number;
    },
    signal?: AbortSignal
  ) => apiClient.get<PaginatedResponse<MyScore>>('/my-scores', params, { signal }),
};
