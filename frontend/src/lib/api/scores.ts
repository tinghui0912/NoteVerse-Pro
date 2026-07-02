import { apiClient } from '@/lib/api-client';
import type {
  ApiResponse,
  FingeringHandSize,
  ScoreArtifact,
  ScoreDetail,
  FingeringResult,
  ScoreMetadata,
  ScoreRevision,
  ScoreRevisionContent,
  PaginatedResponse,
} from '@/types/api';

export const scoresApi = {
  list: (params: { page: number; page_size: number; search?: string }, signal?: AbortSignal) =>
    apiClient.get<PaginatedResponse<ScoreDetail>>('/scores', params, { signal }),
  detail: (scoreId: string, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<ScoreDetail>>(`/scores/${scoreId}`, undefined, { signal }),
  update: (
    scoreId: string,
    input: {
      title?: string;
      taxonomy_tags?: Array<{ category: string; code: string }>;
      expected_version: number;
    }
  ) =>
    apiClient.patch<ApiResponse<ScoreDetail>>(`/scores/${scoreId}`, input),
  remove: (scoreId: string) => apiClient.delete<ApiResponse<never>>(`/scores/${scoreId}`),
  batchDelete: (scoreIds: string[]) =>
    apiClient.post<ApiResponse<{ removed: number }>>('/scores/batch-delete', { score_ids: scoreIds }),
  revisions: (scoreId: string, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<ScoreRevision[]>>(`/scores/${scoreId}/revisions`, undefined, { signal }),
  revisionContent: (scoreId: string, revisionId: string, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<ScoreRevisionContent>>(
      `/scores/${scoreId}/revisions/${revisionId}/content`,
      undefined,
      { signal }
    ),
  createRevision: (
    scoreId: string,
    input: { content: string; base_revision_id: string; idempotency_key?: string; origin?: string }
  ) => apiClient.post<ApiResponse<ScoreRevision>>(`/scores/${scoreId}/revisions`, input),
  generateFingering: (
    scoreId: string,
    input: { content: string; hand_size?: FingeringHandSize }
  ) => apiClient.post<ApiResponse<FingeringResult>>(`/scores/${scoreId}/fingering`, input),
  artifacts: (
    scoreId: string,
    params?: { revision_id?: string; kind?: string },
    signal?: AbortSignal
  ) => apiClient.get<ApiResponse<ScoreArtifact[]>>(`/scores/${scoreId}/artifacts`, params, { signal }),
  render: (scoreId: string, revisionId: string, profile = 'default') =>
    apiClient.post<ApiResponse<ScoreArtifact[]>>(
      `/scores/${scoreId}/revisions/${revisionId}/render?profile=${encodeURIComponent(profile)}`
    ),
  metadata: (scoreId: string, revisionId: string, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<ScoreMetadata>>(
      `/scores/${scoreId}/revisions/${revisionId}/metadata`,
      undefined,
      { signal }
    ),
  downloadArtifact: (artifactId: string) =>
    apiClient.download(`/artifacts/${artifactId}/download`),
  downloadArtifactArchive: (scoreId: string, revisionId: string, kind: string) =>
    apiClient.download(
      `/scores/${scoreId}/artifact-archive?revision_id=${encodeURIComponent(revisionId)}&kind=${encodeURIComponent(kind)}`
    ),
};
