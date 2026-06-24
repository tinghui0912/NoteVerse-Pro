import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { jobsApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import type { ProcessingJob } from '@/types/api';

const ACTIVE_JOB_STATES = new Set<ProcessingJob['state']>(['PENDING', 'PROGRESS']);

function hasActiveJobs(jobs: ProcessingJob[] | undefined) {
  return (jobs ?? []).some((job) => ACTIVE_JOB_STATES.has(job.state));
}

export function useJobDetail(
  jobId: string,
  options?: { enabled?: boolean; refetchInterval?: number | false }
) {
  return useQuery({
    queryKey: queryKeys.jobs.detail(jobId),
    queryFn: ({ signal }) => jobsApi.getJob(jobId, signal),
    enabled: options?.enabled ?? Boolean(jobId),
    refetchInterval: options?.refetchInterval,
  });
}

export function useJobList(page: number, pageSize: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.jobs.list(page, pageSize),
    queryFn: ({ signal }) => jobsApi.listJobs(page, pageSize, signal),
    enabled,
    refetchInterval: (query) => {
      if (!enabled) return false;
      return hasActiveJobs(query.state.data?.data) ? 5000 : false;
    },
  });
}

export function useSubmitJob() {
  return useMutation({
    mutationFn: ({ fileIds, options, idempotencyKey }: {
      fileIds: string[];
      options?: Record<string, unknown>;
      idempotencyKey?: string;
    }) => jobsApi.submitJob(fileIds, options, idempotencyKey),
  });
}

export function useDeleteJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: jobsApi.deleteJob,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all }),
  });
}
