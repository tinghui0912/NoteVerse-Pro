import { guestPreviewQueryKeys } from '@/features/scores/guest-preview/query-keys';
import { guestPreviewSettingsUpdated } from '@/features/scores/guest-preview/cache';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { guestPreviewApi } from '@/features/scores/guest-preview/api';

export function useGuestPreview(token: string) {
  return useQuery({
    queryKey: guestPreviewQueryKeys.public(token),
    queryFn: ({ signal }) => guestPreviewApi.read(token, signal),
    enabled: Boolean(token),
    staleTime: 0,
    retry: false,
  });
}

export function useGuestPreviewSettings(scoreId: string) {
  return useQuery({
    queryKey: guestPreviewQueryKeys.settings(scoreId),
    queryFn: ({ signal }) => guestPreviewApi.getSettings(scoreId, signal),
  });
}

export function useIssueGuestPreviewCredential(scoreId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => guestPreviewApi.issueCredential(scoreId),
    gcTime: 0,
    onSuccess: ({ issued_at }) =>
      guestPreviewSettingsUpdated(client, scoreId, { enabled: true, issued_at }),
  });
}

export function useRotateGuestPreviewCredential(scoreId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => guestPreviewApi.rotateCredential(scoreId),
    gcTime: 0,
    onSuccess: ({ issued_at }) =>
      guestPreviewSettingsUpdated(client, scoreId, { enabled: true, issued_at }),
  });
}

export function useRevokeGuestPreviewCredential(scoreId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => guestPreviewApi.revokeCredential(scoreId),
    onSuccess: () =>
      guestPreviewSettingsUpdated(client, scoreId, { enabled: false, issued_at: null }),
  });
}
