import type { ReviewConfirmRequest, ReviewUpdateRequest } from '@/generated/api';
import { importJobReviewConfirm, importJobReviewGet, importJobReviewUpdate } from '@/generated/api';
import { customerTransport, responseBody } from '@/lib/http/customer-browser-transport';

export const importReviewApi = {
  detail: (jobId: string, signal?: AbortSignal) =>
    responseBody(importJobReviewGet({ ...customerTransport.authenticated, path: { job_id: jobId }, signal })),
  update: (jobId: string, input: ReviewUpdateRequest) =>
    responseBody(importJobReviewUpdate({ ...customerTransport.authenticated, path: { job_id: jobId }, body: input })),
  confirm: (jobId: string, input: ReviewConfirmRequest) =>
    responseBody(importJobReviewConfirm({ ...customerTransport.authenticated, path: { job_id: jobId }, body: input })),
};
