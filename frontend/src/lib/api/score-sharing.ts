import { apiClient } from '@/lib/api-client';
import type {
  ApiResponse,
  CreatedScoreGrant,
  ScoreGrant,
  ScoreGrantBookmark,
  ScoreGrantAccess,
  ScoreGrantContent,
} from '@/types/api';

export const scoreSharingApi = {
  listGrants: (scoreId: string, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<ScoreGrant[]>>(`/scores/${scoreId}/grants`, undefined, { signal }),
  createGrant: (
    scoreId: string,
    input: {
      target_mode?: 'LATEST' | 'PINNED';
      target_revision_id?: string;
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
  content: (token: string, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<ScoreGrantContent>>(`/score-grants/${token}/content`, undefined, {
      signal,
      suppressAuthRedirect: true,
    }),
  downloadArtifact: (token: string, artifactId: string) =>
    apiClient.download(`/score-grants/${token}/artifacts/${artifactId}/download`, {
      suppressAuthRedirect: true,
    }),
  viewArtifact: (token: string, artifactId: string) =>
    apiClient.download(`/score-grants/${token}/artifacts/${artifactId}/view`, {
      suppressAuthRedirect: true,
    }),
  bookmark: (token: string) =>
    apiClient.post<ApiResponse<ScoreGrantBookmark>>(`/score-grants/${token}/bookmark`),
};
