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
  return useMutation({
    mutationFn: ({ jobId, content, title }: { jobId: string; content: string; title?: string }) =>
      reviewApi.confirm(jobId, { content, title }),
  });
}

export function useUpdateImportJobReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, content }: { jobId: string; content: string }) =>
      reviewApi.update(jobId, { content }),
    onSuccess: (_response, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.review.detail(variables.jobId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.myScores.lists() });
    },
  });
}
