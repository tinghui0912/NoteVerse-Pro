import { reviewConfirmed, reviewUpdated } from '@/lib/cache-effects/imports';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { reviewApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';

export function useImportJobReview(jobId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.review.detail(jobId),
    queryFn: ({ signal }) => reviewApi.detail(jobId, signal),
    enabled: enabled && Boolean(jobId),
  });
}

export function useConfirmImportJobReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, content, displayTitle }: { jobId: string; content: string; displayTitle?: string }) =>
      reviewApi.confirm(jobId, { content, display_title: displayTitle }),
    onSuccess: (response, variables) => reviewConfirmed(queryClient, variables.jobId, response.score_id),
  });
}

export function useUpdateImportJobReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, content }: { jobId: string; content: string }) =>
      reviewApi.update(jobId, { content }),
    onSuccess: (_response, variables) => reviewUpdated(queryClient, variables.jobId),
  });
}
