import { apiClient, apiUrl } from '@/lib/api-client';
import type {
  ApiResponse,
  FingeringHandSize,
  ScoreDetail,
  FingeringResult,
  ScoreRevisionAssets,
  ScoreRevision,
  ScoreRevisionList,
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
  revisions: (scoreId: string, params?: { limit?: number; cursor?: number | null }, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<ScoreRevisionList>>(
      `/scores/${scoreId}/revisions`,
      {
        limit: params?.limit,
        cursor: params?.cursor ?? undefined,
      },
      { signal }
    ),
  createRevision: (
    scoreId: string,
    input: { content: string; base_revision_id: string; idempotency_key?: string; origin?: string }
  ) => apiClient.post<ApiResponse<ScoreRevision>>(`/scores/${scoreId}/revisions`, input),
  restoreRevision: (scoreId: string, revisionId: string, input?: { note?: string | null }) =>
    apiClient.post<ApiResponse<ScoreRevision>>(
      `/scores/${scoreId}/revisions/${revisionId}/restore`,
      input ?? {}
    ),
  updateRevisionNote: (scoreId: string, revisionId: string, input: { note?: string | null }) =>
    apiClient.patch<ApiResponse<ScoreRevision>>(
      `/scores/${scoreId}/revisions/${revisionId}/note`,
      input
    ),
  generateFingering: (
    scoreId: string,
    input: { content: string; hand_size?: FingeringHandSize }
  ) => apiClient.post<ApiResponse<FingeringResult>>(`/scores/${scoreId}/fingering`, input),
  revisionAssets: (
    scoreId: string,
    params?: { revision_id?: string },
    signal?: AbortSignal
  ) => apiClient.get<ApiResponse<ScoreRevisionAssets>>(`/scores/${scoreId}/revision-assets`, params, { signal }),
  downloadRevisionSource: (sourceId: string) =>
    apiClient.download(`/revision-sources/${sourceId}/download`),
  downloadRenderAsset: (renderAssetId: string) =>
    apiClient.download(`/render-assets/${renderAssetId}/download`),
  downloadRenderAssetArchive: (scoreId: string, revisionId: string, kind: string) =>
    apiClient.download(
      `/scores/${scoreId}/render-asset-archive?revision_id=${encodeURIComponent(revisionId)}&kind=${encodeURIComponent(kind)}`
    ),
  playbackUrl: (scoreId: string, revisionId: string) =>
    apiUrl(`/scores/${scoreId}/revisions/${revisionId}/playback`),
};
