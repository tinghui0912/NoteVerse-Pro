import { guestPreviewSettingsUpdated } from '@/lib/cache-effects/scores';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { guestPreviewApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import type { GuestPreviewUpdateRequest } from '@/generated/api';

export function useGuestPreview(token: string) {
  return useQuery({
    queryKey: queryKeys.scores.guestPreview(token),
    queryFn: ({ signal }) => guestPreviewApi.read(token, signal),
    enabled: Boolean(token),
    staleTime: 0,
    retry: false,
  });
}

export function useGuestPreviewSettings(scoreId: string) {
  return useQuery({
    queryKey: queryKeys.scores.guestPreviewSettings(scoreId),
    queryFn: ({ signal }) => guestPreviewApi.getSettings(scoreId, signal),
  });
}

export function useUpdateGuestPreviewSettings(scoreId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: GuestPreviewUpdateRequest) =>
      guestPreviewApi.updateSettings(scoreId, input),
    onSuccess: (settings) =>
      guestPreviewSettingsUpdated(client, scoreId, settings),
  });
}
