import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ImportJobRequestedOptions, ImportJobRead } from '@/generated/api';
import { importJobsApi } from './api/jobs';
import { importReviewApi } from './api/review';
import { importQueryKeys } from './query-keys';
import { importSubmitted, importDeleted, reviewConfirmed, reviewUpdated } from './cache';

const ACTIVE_JOB_STATES = new Set<ImportJobRead['state']>([
  'QUEUED',
  'PROCESSING',
]);

function hasActiveJobs(jobs: ImportJobRead[] | undefined) {
  return (jobs ?? []).some((job) => ACTIVE_JOB_STATES.has(job.state));
}

export function useImportJobDetail(
  jobId: string,
  options?: { enabled?: boolean; refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: importQueryKeys.jobs.detail(jobId),
    queryFn: ({ signal }) => importJobsApi.getImportJob(jobId, signal),
    enabled: options?.enabled ?? Boolean(jobId),
    refetchInterval: options?.refetchInterval,
  });
}

export function useImportJobList(
  page: number,
  pageSize: number,
  enabled = true,
) {
  return useQuery({
    queryKey: importQueryKeys.jobs.list(page, pageSize),
    queryFn: ({ signal }) =>
      importJobsApi.listImportJobs(page, pageSize, signal),
    enabled,
    refetchInterval: (query) => {
      if (!enabled) return false;
      return hasActiveJobs(query.state.data?.items) ? 5000 : false;
    },
  });
}

export function useSubmitImportJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      uploadIds,
      options,
      idempotencyKey,
    }: {
      uploadIds: string[];
      options?: ImportJobRequestedOptions;
      idempotencyKey?: string;
    }) => importJobsApi.submitImportJob(uploadIds, options, idempotencyKey),
    onSuccess: () =>
      importSubmitted(queryClient),
  });
}

export function useDeleteImportJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: importJobsApi.deleteImportJob,
    onSuccess: (_response, jobId) => importDeleted(queryClient, jobId),
  });
}

export function useRetryImportJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: importJobsApi.retryImportJob,
    onSuccess: () =>
      importSubmitted(queryClient),
  });
}

export function useImportJobReview(jobId: string, enabled = true) {
  return useQuery({
    queryKey: importQueryKeys.review(jobId),
    queryFn: ({ signal }) => importReviewApi.detail(jobId, signal),
    enabled: enabled && Boolean(jobId),
  });
}

export function useConfirmImportJobReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, content, displayTitle }: { jobId: string; content: string; displayTitle?: string }) =>
      importReviewApi.confirm(jobId, { content, display_title: displayTitle }),
    onSuccess: (response, variables) => reviewConfirmed(queryClient, variables.jobId, response.score_id),
  });
}

export function useUpdateImportJobReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, content }: { jobId: string; content: string }) =>
      importReviewApi.update(jobId, { content }),
    onSuccess: (_response, variables) => reviewUpdated(queryClient, variables.jobId),
  });
}
