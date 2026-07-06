import { apiClient } from '@/lib/api-client';
import type {
  ApiResponse,
  FingeringHandSize,
  ScoreArtifact,
  ScoreDetail,
  FingeringResult,
  ScoreRevision,
  ScoreRevisionContent,
} from '@/types/api';

export const scoresApi = {
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
  batchDelete: (scoreIds: string[]) =>
    apiClient.post<ApiResponse<{ removed: number }>>('/scores/batch-delete', { score_ids: scoreIds }),
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
  downloadArtifact: (artifactId: string) =>
    apiClient.download(`/artifacts/${artifactId}/download`),
  downloadArtifactArchive: (scoreId: string, revisionId: string, kind: string) =>
    apiClient.download(
      `/scores/${scoreId}/artifact-archive?revision_id=${encodeURIComponent(revisionId)}&kind=${encodeURIComponent(kind)}`
    ),
};
