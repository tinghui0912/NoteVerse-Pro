import { importSubmitted, importDeleted } from '@/lib/cache-effects/imports';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { importJobsApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import type {
  ImportJobProcessingOptions,
  ImportJobRead,
} from '@/generated/api';

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
    queryKey: queryKeys.importJobs.detail(jobId),
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
    queryKey: queryKeys.importJobs.list(page, pageSize),
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
      options?: ImportJobProcessingOptions;
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
