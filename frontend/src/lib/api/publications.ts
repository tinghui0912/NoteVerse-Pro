import { apiClient, apiUrl } from '@/lib/api-client';
import type { ApiResponse, Publication, PublicScore, PublicScoreContent } from '@/types/api';

export const publicationsApi = {
  forScore: (scoreId: string, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<Publication>>(`/scores/${scoreId}/publication`, undefined, { signal }),
  publish: (
    scoreId: string,
    input: {
      revision_id?: string;
      public_slug?: string;
      allow_download: boolean;
      allow_practice: boolean;
    }
  ) => apiClient.put<ApiResponse<Publication>>(`/scores/${scoreId}/publication`, input),
  unpublish: (scoreId: string) =>
    apiClient.delete<ApiResponse<Publication>>(`/scores/${scoreId}/publication`),
  detail: (slug: string, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<PublicScore>>(`/publications/${slug}`, undefined, {
      signal,
      suppressAuthRedirect: true,
    }),
  content: (slug: string, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<PublicScoreContent>>(`/publications/${slug}/content`, undefined, {
      signal,
      suppressAuthRedirect: true,
    }),
  playbackUrl: (slug: string) => apiUrl(`/publications/${slug}/playback`),
  downloadArtifact: (slug: string, artifactId: string) =>
    apiClient.download(`/publications/${slug}/artifacts/${artifactId}/download`, {
      suppressAuthRedirect: true,
    }),
};
