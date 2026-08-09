import { apiClient, apiUrl } from '@/lib/api-client';
import type { ApiResponse } from '@/lib/api-client';
import type {
  GrantAccessRead,
  GrantBookmarkRead,
  GrantCreatedRead,
  GrantCreateRequest,
  GrantRead,
} from '@/generated/api';

export const scoreSharingApi = {
  listGrants: (scoreId: string, options?: { limit?: number; signal?: AbortSignal }) =>
    apiClient.get<ApiResponse<GrantRead[]>>(
      `/scores/${scoreId}/grants`,
      { limit: options?.limit },
      { signal: options?.signal }
    ),
  createGrant: (
    scoreId: string,
    input: GrantCreateRequest
  ) => apiClient.post<ApiResponse<GrantCreatedRead>>(`/scores/${scoreId}/grants`, input),
  revokeGrant: (grantId: string) =>
    apiClient.post<ApiResponse<GrantRead>>(`/scores/grants/${grantId}/revoke`),
  restoreGrant: (grantId: string) =>
    apiClient.post<ApiResponse<GrantRead>>(`/scores/grants/${grantId}/restore`),
  deleteGrant: (grantId: string) =>
    apiClient.delete<ApiResponse<{ deleted: boolean }>>(`/scores/grants/${grantId}`),
  access: (token: string, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<GrantAccessRead>>(`/score-grants/${token}`, undefined, {
      signal,
      suppressAuthRedirect: true,
    }),
  playbackUrl: (token: string) => apiUrl(`/score-grants/${token}/playback`),
  downloadRevisionSource: (token: string, sourceId: string) =>
    apiClient.download(`/score-grants/${token}/revision-sources/${sourceId}/download`, {
      suppressAuthRedirect: true,
    }),
  downloadRenderAsset: (token: string, renderAssetId: string) =>
    apiClient.download(`/score-grants/${token}/render-assets/${renderAssetId}/download`, {
      suppressAuthRedirect: true,
    }),
  bookmark: (token: string) =>
    apiClient.post<ApiResponse<GrantBookmarkRead>>(`/score-grants/${token}/bookmark`),
};
