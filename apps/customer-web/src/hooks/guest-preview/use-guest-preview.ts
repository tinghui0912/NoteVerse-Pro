import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { guestPreviewsApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import type { GuestPreviewCreateRequest } from '@/generated/api';

export function useGuestPreview(token: string) {
  return useQuery({
    queryKey: queryKeys.scores.guestPreview(token),
    queryFn: ({ signal }) => guestPreviewsApi.read(token, signal),
    enabled: Boolean(token),
    staleTime: 0,
    retry: false,
  });
}

export function useGuestPreviews(scoreId: string) {
  return useQuery({
    queryKey: queryKeys.scores.guestPreviews(scoreId),
    queryFn: ({ signal }) => guestPreviewsApi.list(scoreId, signal),
  });
}

export function useCreateGuestPreview(scoreId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: GuestPreviewCreateRequest) => guestPreviewsApi.create(scoreId, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.scores.guestPreviews(scoreId) });
    },
  });
}

export function useRevokeGuestPreview(scoreId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: guestPreviewsApi.revoke,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.scores.guestPreviews(scoreId) });
    },
  });
}

export function useDeleteGuestPreview(scoreId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: guestPreviewsApi.delete,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.scores.guestPreviews(scoreId) });
    },
  });
}
