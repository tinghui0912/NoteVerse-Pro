import { apiClient, apiUrl } from '@/lib/api-client';
import type { ApiResponse } from '@/lib/api-client';
import type { GuestPreviewRead, GuestPreviewCreatedRead, GuestPreviewCreateRequest, GuestPreviewListItem } from '@/generated/api';

export const guestPreviewsApi = {
  list: (scoreId: string, signal?: AbortSignal) => apiClient.get<ApiResponse<GuestPreviewListItem[]>>(`/scores/${scoreId}/guest-previews`, undefined, { signal }),
  create: (scoreId: string, input: GuestPreviewCreateRequest) => apiClient.post<ApiResponse<GuestPreviewCreatedRead>>(`/scores/${scoreId}/guest-previews`, input),
  revoke: (previewId: string) => apiClient.post<ApiResponse<GuestPreviewListItem>>(`/scores/guest-previews/${previewId}/revoke`),
  delete: (previewId: string) => apiClient.delete<ApiResponse<{ deleted: boolean }>>(`/scores/guest-previews/${previewId}`),
  read: (token: string, signal?: AbortSignal) => apiClient.get<ApiResponse<GuestPreviewRead>>(`/guest-previews/${token}`, undefined, { signal, suppressAuthRedirect: true }),
  pageUrl: (token: string, assetId: string) => apiUrl(`/guest-previews/${encodeURIComponent(token)}/render-assets/${encodeURIComponent(assetId)}/view`),
  playbackUrl: (token: string) => apiUrl(`/guest-previews/${encodeURIComponent(token)}/playback`),
};
