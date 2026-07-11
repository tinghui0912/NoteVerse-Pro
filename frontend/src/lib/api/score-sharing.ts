import { apiClient, apiUrl } from '@/lib/api-client';
import type {
  ApiResponse,
  CreatedScoreGrant,
  ScoreGrant,
  ScoreGrantBookmark,
  ScoreGrantAccess,
} from '@/types/api';

export const scoreSharingApi = {
  listGrants: (scoreId: string, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<ScoreGrant[]>>(`/scores/${scoreId}/grants`, undefined, { signal }),
  createGrant: (
    scoreId: string,
    input: {
      allow_download: boolean;
      allow_practice: boolean;
      expires_at?: string | null;
    }
  ) => apiClient.post<ApiResponse<CreatedScoreGrant>>(`/scores/${scoreId}/grants`, input),
  revokeGrant: (grantId: string) =>
    apiClient.post<ApiResponse<ScoreGrant>>(`/scores/grants/${grantId}/revoke`),
  restoreGrant: (grantId: string) =>
    apiClient.post<ApiResponse<ScoreGrant>>(`/scores/grants/${grantId}/restore`),
  deleteGrant: (grantId: string) =>
    apiClient.delete<ApiResponse<{ deleted: boolean }>>(`/scores/grants/${grantId}`),
  access: (token: string, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<ScoreGrantAccess>>(`/score-grants/${token}`, undefined, {
      signal,
      suppressAuthRedirect: true,
    }),
  playbackUrl: (token: string) => apiUrl(`/score-grants/${token}/playback`),
  downloadArtifact: (token: string, artifactId: string) =>
    apiClient.download(`/score-grants/${token}/artifacts/${artifactId}/download`, {
      suppressAuthRedirect: true,
    }),
  bookmark: (token: string) =>
    apiClient.post<ApiResponse<ScoreGrantBookmark>>(`/score-grants/${token}/bookmark`),
};
