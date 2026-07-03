import { apiClient } from '@/lib/api-client';
import type { ApiResponse, ImportJobReview, ReviewConfirmResult, ReviewUpdateResult } from '@/types/api';

export const reviewApi = {
  detail: (jobId: string, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<ImportJobReview>>(`/review/${jobId}`, undefined, { signal }),
  update: (jobId: string, input: { content: string }) =>
    apiClient.patch<ApiResponse<ReviewUpdateResult>>(`/review/${jobId}`, input),
  confirm: (jobId: string, input: { content: string; title?: string }) =>
    apiClient.post<ApiResponse<ReviewConfirmResult>>(`/review/${jobId}/confirm`, input),
};
