import { apiClient, apiUrl } from '@/lib/api-client';
import type { ApiResponse } from '@/lib/api-client';
import type {
  GuestPreviewRead,
  GuestPreviewSettingsRead,
  GuestPreviewUpdateRequest,
} from '@/generated/api';

export const guestPreviewApi = {
  getSettings: (scoreId: string, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<GuestPreviewSettingsRead>>(
      `/scores/${scoreId}/guest-preview`,
      undefined,
      { signal }
    ),
  updateSettings: (scoreId: string, input: GuestPreviewUpdateRequest) =>
    apiClient.patch<ApiResponse<GuestPreviewSettingsRead>>(
      `/scores/${scoreId}/guest-preview`,
      input
    ),
  read: (token: string, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<GuestPreviewRead>>(`/guest-previews/${token}`, undefined, {
      signal,
      suppressAuthRedirect: true,
    }),
  pageUrl: (token: string, assetId: string) =>
    apiUrl(
      `/guest-previews/${encodeURIComponent(token)}/render-assets/${encodeURIComponent(assetId)}/view`
    ),
  playbackUrl: (token: string) => apiUrl(`/guest-previews/${encodeURIComponent(token)}/playback`),
};
