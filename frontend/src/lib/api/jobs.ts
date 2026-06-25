import { apiClient, type ApiResponse, type PaginatedResponse } from '../api-client';
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

export async function listJobs(
  page: number,
  pageSize: number,
  signal?: AbortSignal
): Promise<PaginatedResponse<ProcessingJob>> {
  return apiClient.get<PaginatedResponse<ProcessingJob>>(
    '/jobs',
    { page, page_size: pageSize },
    { signal }
  );
}

export async function downloadJobArtifact(jobId: string, artifactId: string): Promise<Blob> {
  return apiClient.download(`/jobs/${jobId}/artifacts/${artifactId}/download`);
}

export async function deleteJob(jobId: string): Promise<ApiResponse<never>> {
  return apiClient.delete<ApiResponse<never>>(`/jobs/${jobId}`);
}

export async function retryJob(jobId: string): Promise<ApiResponse<{ job_id: string }>> {
  return apiClient.post<ApiResponse<{ job_id: string }>>(`/jobs/${jobId}/retry`);
}

export const jobsApi = { deleteJob, downloadJobArtifact, getJob, listJobs, retryJob, submitJob };
