import { useMutation, useQuery } from '@tanstack/react-query';
import { jobsApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';

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

export function useSubmitJob() {
  return useMutation({
    mutationFn: ({ fileIds, options, idempotencyKey }: {
      fileIds: string[];
      options?: Record<string, unknown>;
      idempotencyKey?: string;
    }) => jobsApi.submitJob(fileIds, options, idempotencyKey),
  });
}
