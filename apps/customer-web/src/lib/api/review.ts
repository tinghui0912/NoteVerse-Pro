import type { ReviewConfirmRequest, ReviewUpdateRequest } from '@/generated/api';
import { importJobReviewConfirm, importJobReviewGet, importJobReviewUpdate } from '@/generated/api';
import { customerTransport, responseData } from '@/lib/http/customer-browser-transport';

export const reviewApi = {
  detail: (jobId: string, signal?: AbortSignal) =>
    responseData(importJobReviewGet({ ...customerTransport.authenticated, path: { job_id: jobId }, signal })),
  update: (jobId: string, input: ReviewUpdateRequest) =>
    responseData(importJobReviewUpdate({ ...customerTransport.authenticated, path: { job_id: jobId }, body: input })),
  confirm: (jobId: string, input: ReviewConfirmRequest) =>
    responseData(importJobReviewConfirm({ ...customerTransport.authenticated, path: { job_id: jobId }, body: input })),
};
