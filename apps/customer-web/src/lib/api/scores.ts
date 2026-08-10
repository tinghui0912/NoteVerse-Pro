import { apiClient, apiUrl } from '@/lib/api-client';
import type { ApiResponse } from '@/lib/api-client';
import type {
  FingeringRequest,
  FingeringResultRead,
  RevisionContentRead,
  RevisionCreateRequest,
  RevisionListRead,
  RevisionNoteUpdateRequest,
  RevisionRead,
  RevisionRestoreRequest,
  ScoreRead,
  ScoreRevisionAssetsRead,
  ScoreUpdateRequest,
} from '@/generated/api';

export const scoresApi = {
  detail: (scoreId: string, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<ScoreRead>>(`/scores/${scoreId}`, undefined, { signal }),
  update: (
    scoreId: string,
    input: ScoreUpdateRequest
  ) => apiClient.patch<ApiResponse<ScoreRead>>(`/scores/${scoreId}`, input),
  batchDelete: (scoreIds: string[]) =>
    apiClient.post<ApiResponse<{ removed: number }>>('/scores/batch-delete', { score_ids: scoreIds }),
  revisionContent: (scoreId: string, revisionId: string, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<RevisionContentRead>>(
      `/scores/${scoreId}/revisions/${revisionId}/content`,
      undefined,
      { signal }
    ),
  revisions: (scoreId: string, params?: { limit?: number; cursor?: number | string | null }, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<RevisionListRead>>(
      `/scores/${scoreId}/revisions`,
      {
        limit: params?.limit,
        cursor: params?.cursor ?? undefined,
      },
      { signal }
    ),
  createRevision: (
    scoreId: string,
    input: RevisionCreateRequest
  ) => apiClient.post<ApiResponse<RevisionRead>>(`/scores/${scoreId}/revisions`, input),
  restoreRevision: (scoreId: string, revisionId: string, input?: RevisionRestoreRequest) =>
    apiClient.post<ApiResponse<RevisionRead>>(
      `/scores/${scoreId}/revisions/${revisionId}/restore`,
      input ?? {}
    ),
  updateRevisionNote: (scoreId: string, revisionId: string, input: RevisionNoteUpdateRequest) =>
    apiClient.patch<ApiResponse<RevisionRead>>(
      `/scores/${scoreId}/revisions/${revisionId}/note`,
      input
    ),
  generateFingering: (
    scoreId: string,
    input: FingeringRequest
  ) => apiClient.post<ApiResponse<FingeringResultRead>>(`/scores/${scoreId}/fingering`, input),
  revisionAssets: (
    scoreId: string,
    params?: { revision_id?: string },
    signal?: AbortSignal
  ) => apiClient.get<ApiResponse<ScoreRevisionAssetsRead>>(`/scores/${scoreId}/revision-assets`, params, { signal }),
  downloadInputAsset: (scoreId: string, assetId: string) =>
    apiClient.download(`/scores/${scoreId}/input-assets/${assetId}/download`),
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
