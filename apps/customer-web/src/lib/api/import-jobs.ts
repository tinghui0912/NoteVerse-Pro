import type { ImportJobProcessingOptions, ImportJobSubmitRequest } from '@/generated/api';
import { importJobArtifactDownload, importJobDelete, importJobGet, importJobRetry, importJobsList, importJobsSubmit } from '@/generated/api';
import { customerTransport, responseBody, responseComplete } from '@/lib/http/customer-browser-transport';

async function submitImportJob(
  fileIds: string[],
  options?: ImportJobProcessingOptions,
  idempotencyKey?: string,
) {
  const request: ImportJobSubmitRequest = {
    file_ids: fileIds,
    idempotency_key: idempotencyKey,
    options,
  };
  return responseBody(importJobsSubmit({ ...customerTransport.authenticated, body: request }));
}

async function getImportJob(
  jobId: string,
  signal?: AbortSignal,
) {
  return responseBody(importJobGet({ ...customerTransport.authenticated, path: { job_id: jobId }, signal }));
}

async function listImportJobs(
  page: number,
  pageSize: number,
  signal?: AbortSignal,
) {
  return responseBody(importJobsList({ ...customerTransport.authenticated, query: { page, page_size: pageSize }, signal }));
}

async function downloadImportJobArtifact(
  jobId: string,
  artifactId: string,
): Promise<Blob> {
  return responseBody(importJobArtifactDownload({ ...customerTransport.authenticated, path: { job_id: jobId, artifact_id: artifactId }, parseAs: 'blob' }));
}

async function deleteImportJob(jobId: string) {
  return responseComplete(importJobDelete({ ...customerTransport.authenticated, path: { job_id: jobId } }));
}

async function retryImportJob(
  jobId: string,
) {
  return responseBody(importJobRetry({ ...customerTransport.authenticated, path: { job_id: jobId } }));
}

export const importJobsApi = {
  retryImportJob,
  deleteImportJob,
  downloadImportJobArtifact,
  getImportJob,
  listImportJobs,
  submitImportJob,
};
