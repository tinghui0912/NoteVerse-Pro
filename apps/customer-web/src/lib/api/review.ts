import { apiClient } from '@/lib/api-client';
import type { ApiResponse } from '@/lib/api-client';
import type {
  ImportJobReviewRead,
  ReviewConfirmRead,
  ReviewConfirmRequest,
  ReviewUpdateRequest,
} from '@/generated/api';

export const reviewApi = {
  detail: (jobId: string, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<ImportJobReviewRead>>(`/review/${jobId}`, undefined, { signal }),
  update: (jobId: string, input: ReviewUpdateRequest) =>
    apiClient.patch<ApiResponse<ImportJobReviewRead>>(`/review/${jobId}`, input),
  confirm: (jobId: string, input: ReviewConfirmRequest) =>
    apiClient.post<ApiResponse<ReviewConfirmRead>>(`/review/${jobId}/confirm`, input),
};
