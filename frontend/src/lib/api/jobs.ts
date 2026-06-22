import { apiClient, type ApiResponse } from '../api-client';
import type { ProcessingJob } from '@/types/api';

export async function submitJob(
  fileIds: string[],
  options?: Record<string, unknown>,
  idempotencyKey?: string
): Promise<ApiResponse<{ job_id: string }>> {
  return apiClient.post<ApiResponse<{ job_id: string }>>('/jobs', {
    file_ids: fileIds,
    idempotency_key: idempotencyKey,
    options,
  });
}

export async function getJob(
  jobId: string,
  signal?: AbortSignal
): Promise<ApiResponse<ProcessingJob>> {
  return apiClient.get<ApiResponse<ProcessingJob>>(`/jobs/${jobId}`, undefined, { signal });
}

export const jobsApi = { getJob, submitJob };
