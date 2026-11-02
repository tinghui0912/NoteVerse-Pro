import { apiClient } from '@/lib/api-client';
import type { PaginatedResponse } from '@/lib/api-client';
import type { MyScoresSort, ScoreRead } from '@/generated/api';

export const myScoresApi = {
  list: (
    params: {
      search?: string;
      sort?: MyScoresSort;
      page: number;
      page_size: number;
    },
    signal?: AbortSignal
  ) => apiClient.get<PaginatedResponse<ScoreRead>>('/my-scores', params, { signal }),
};
