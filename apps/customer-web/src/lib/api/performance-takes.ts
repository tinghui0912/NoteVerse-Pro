import { apiClient, apiUrl, type ApiResponse } from '@/lib/api-client';

export interface PerformanceTakeUploadAuthorizationRequest {
  score_id: number;
  client_request_id: string;
  media_byte_size: number;
  media_mime_type: string;
  duration_ms: number;
  scope_start_beat: number;
  scope_terminal_beat: number;
  revision_id?: number | null;
  artifact_id?: string | null;
  tempo_selection?: Record<string, unknown> | null;
  resolved_tempo_plan?: Record<string, unknown> | null;
  sync_metadata?: Record<string, unknown> | null;
}

export interface PerformanceTakeUploadAuthorizationRead {
  take_id: string;
  upload_url: string;
  upload_method: string;
  upload_headers: Record<string, string>;
  object_key: string;
  reservation_id: string;
  expires_in: number;
}

export interface PerformanceTakeCreateRequest {
  take_id: string;
  client_request_id: string;
  reservation_id: string;
  score_id: number;
  media_byte_size: number;
  media_mime_type: string;
  duration_ms: number;
  scope_start_beat: number;
  scope_terminal_beat: number;
  revision_id?: number | null;
  artifact_id?: string | null;
  tempo_selection?: Record<string, unknown> | null;
  resolved_tempo_plan?: Record<string, unknown> | null;
  sync_metadata?: Record<string, unknown> | null;
}

export interface PerformanceTakeRead {
  take_id: string;
  score_id?: number | null;
  score_title?: string | null;
  revision_id?: number | null;
  artifact_id?: string | null;
  media_kind: string;
  media_mime_type: string;
  media_byte_size: number;
  duration_ms: number;
  scope_start_beat: number;
  scope_terminal_beat: number;
  tempo_selection?: Record<string, unknown> | null;
  resolved_tempo_plan?: Record<string, unknown> | null;
  sync_metadata?: Record<string, unknown> | null;
  created_at: string;
}

export interface PerformanceTakePlaybackRead {
  take_id: string;
  playback_url: string;
  download_url: string;
  media_kind: string;
  media_mime_type: string;
  media_byte_size: number;
  duration_ms: number;
  expires_in: number;
}

export interface PerformanceTakeListResponse {
  items: PerformanceTakeRead[];
  total: number;
  limit?: number;
  offset?: number;
  has_more?: boolean;
}

export const performanceTakesApi = {
  authorizeUpload: (request: PerformanceTakeUploadAuthorizationRequest, signal?: AbortSignal) =>
    apiClient.post<ApiResponse<PerformanceTakeUploadAuthorizationRead>>(
      '/performance-takes/upload-authorizations',
      request,
      { signal }
    ),

  cancelUploadAuthorization: (reservationId: string, signal?: AbortSignal) =>
    apiClient.post<ApiResponse<{ cancelled: boolean }>>(
      `/performance-takes/upload-authorizations/${reservationId}/cancel`,
      undefined,
      { signal }
    ),

  finalizeTake: (request: PerformanceTakeCreateRequest, signal?: AbortSignal) =>
    apiClient.post<ApiResponse<PerformanceTakeRead>>('/performance-takes', request, { signal }),

  listTakes: (params?: { score_id?: number; limit?: number; offset?: number }, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<PerformanceTakeListResponse>>('/performance-takes', params, { signal }),

  getTake: (takeId: string, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<PerformanceTakeRead>>(`/performance-takes/${takeId}`, undefined, { signal }),

  getPlaybackUrl: (takeId: string, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<PerformanceTakePlaybackRead>>(
      `/performance-takes/${takeId}/playback-url`,
      undefined,
      { signal }
    ),

  deleteTake: (takeId: string) =>
    apiClient.delete<ApiResponse<{ deleted: boolean }>>(`/performance-takes/${takeId}`),
};

export async function uploadMediaToSignedUrl(
  uploadUrl: string,
  uploadMethod: string,
  uploadHeaders: Record<string, string>,
  blob: Blob
): Promise<void> {
  const targetUrl = uploadUrl.startsWith('/') ? apiUrl(uploadUrl) : uploadUrl;
  const res = await fetch(targetUrl, {
    method: uploadMethod,
    headers: uploadHeaders,
    body: blob,
  });
  if (!res.ok) {
    throw new Error(`Media upload failed with status ${res.status}`);
  }
}
