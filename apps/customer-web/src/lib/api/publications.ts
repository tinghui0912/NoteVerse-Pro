import { apiClient, apiUrl } from '@/lib/api-client';
import type { ApiResponse } from '@/lib/api-client';
import type { PublicationRead, PublicationUpsertRequest, PublicScoreRead } from '@/generated/api';

export const publicationsApi = {
  forScore: (scoreId: string, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<PublicationRead>>(`/scores/${scoreId}/publication`, undefined, { signal }),
  publish: (
    scoreId: string,
    input: PublicationUpsertRequest
  ) => apiClient.put<ApiResponse<PublicationRead>>(`/scores/${scoreId}/publication`, input),
  unpublish: (scoreId: string) =>
    apiClient.delete<ApiResponse<PublicationRead>>(`/scores/${scoreId}/publication`),
  detail: (slug: string, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<PublicScoreRead>>(`/publications/${slug}`, undefined, {
      signal,
      suppressAuthRedirect: true,
    }),
  playbackUrl: (slug: string) => apiUrl(`/publications/${slug}/playback`),
  downloadRevisionSource: (slug: string, sourceId: string) =>
    apiClient.download(`/publications/${slug}/revision-sources/${sourceId}/download`, {
      suppressAuthRedirect: true,
    }),
  downloadRenderAsset: (slug: string, renderAssetId: string) =>
    apiClient.download(`/publications/${slug}/render-assets/${renderAssetId}/download`, {
      suppressAuthRedirect: true,
    }),
};
