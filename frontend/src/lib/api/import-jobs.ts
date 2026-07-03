import { apiClient, type ApiResponse, type PaginatedResponse } from '../api-client';
import type { ImportJob } from '@/types/api';

export async function submitImportJob(
  fileIds: string[],
  options?: Record<string, unknown>,
  idempotencyKey?: string
): Promise<ApiResponse<{ job_id: string }>> {
  return apiClient.post<ApiResponse<{ job_id: string }>>('/import-jobs', {
    file_ids: fileIds,
    idempotency_key: idempotencyKey,
    options,
  });
}

export async function getImportJob(
  jobId: string,
  signal?: AbortSignal
): Promise<ApiResponse<ImportJob>> {
  return apiClient.get<ApiResponse<ImportJob>>(`/import-jobs/${jobId}`, undefined, { signal });
}

export async function listImportJobs(
  page: number,
  pageSize: number,
  signal?: AbortSignal
): Promise<PaginatedResponse<ImportJob>> {
  return apiClient.get<PaginatedResponse<ImportJob>>(
    '/import-jobs',
    { page, page_size: pageSize },
    { signal }
  );
}

export async function downloadImportJobArtifact(jobId: string, artifactId: string): Promise<Blob> {
  return apiClient.download(`/import-jobs/${jobId}/artifacts/${artifactId}/download`);
}

export async function deleteImportJob(jobId: string): Promise<ApiResponse<never>> {
  return apiClient.delete<ApiResponse<never>>(`/import-jobs/${jobId}`);
}

export const importJobsApi = {
  deleteImportJob,
  downloadImportJobArtifact,
  getImportJob,
  listImportJobs,
  submitImportJob,
};
