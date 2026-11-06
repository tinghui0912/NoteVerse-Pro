import { apiClient, apiUrl, type ApiResponse } from '@/lib/api-client';
import type {
  PerformanceTakeDeleteResponse,
  PerformanceTakeListResponse,
  PerformanceTakePlaybackRead,
  PerformanceTakeRead,
  PerformanceTakeManifestRead,
  PerformanceTakeUploadReservationRead,
  PerformanceTakeUploadReservationRequest,
  RecordingTimebase,
  PerformanceTakeTempoPlan,
} from '@/generated/api/types.gen';

export type {
  PerformanceTakeDeleteResponse,
  PerformanceTakeListResponse,
  PerformanceTakePlaybackRead,
  PerformanceTakeRead,
  PerformanceTakeManifestRead,
  PerformanceTakeUploadReservationRead,
  PerformanceTakeUploadReservationRequest,
  RecordingTimebase,
  PerformanceTakeTempoPlan,
};

export const performanceTakesApi = {
  reserveUpload: (
    request: PerformanceTakeUploadReservationRequest,
    signal?: AbortSignal,
  ) =>
    apiClient.post<ApiResponse<PerformanceTakeUploadReservationRead>>(
      '/performance-takes/upload-reservations',
      request,
      { signal },
    ),

  cancelUploadReservation: (reservationId: string) =>
    apiClient.delete<ApiResponse<{ cancelled: boolean }>>(
      `/performance-takes/upload-reservations/${reservationId}`,
    ),

  finalizeTake: (reservationId: string, signal?: AbortSignal) =>
    apiClient.post<ApiResponse<PerformanceTakeRead>>(
      `/performance-takes/upload-reservations/${reservationId}/finalize`,
      undefined,
      { signal },
    ),

  listTakes: (
    params?: { score_id?: string; limit?: number; offset?: number },
    signal?: AbortSignal,
  ) =>
    apiClient.get<ApiResponse<PerformanceTakeListResponse>>(
      '/performance-takes',
      params,
      { signal },
    ),

  getTake: (takeId: string, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<PerformanceTakeRead>>(
      `/performance-takes/${takeId}`,
      undefined,
      { signal },
    ),

  getPlaybackUrl: (takeId: string, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<PerformanceTakePlaybackRead>>(
      `/performance-takes/${takeId}/playback-url`,
      undefined,
      { signal },
    ),
  deleteTake: (takeId: string) =>
    apiClient.delete<ApiResponse<PerformanceTakeDeleteResponse>>(
      `/performance-takes/${takeId}`,
    ),
};

/** Authenticated transport only; byte materialization belongs to the consumer. */
export function openPerformanceTakeMedia(
  takeId: string,
  signal?: AbortSignal,
): Promise<Response> {
  return apiClient.getRaw(
    `/performance-takes/${encodeURIComponent(takeId)}/media`,
    undefined,
    { signal },
  );
}

export async function uploadMediaToSignedUrl(
  uploadUrl: string,
  method: string,
  headers: Record<string, string>,
  body: Blob | ArrayBuffer,
): Promise<void> {
  const isDirectOss =
    uploadUrl.startsWith('http://') || uploadUrl.startsWith('https://');
  const targetUrl = isDirectOss ? uploadUrl : apiUrl(uploadUrl);

  const res = await fetch(targetUrl, {
    method,
    headers,
    body,
  });

  if (!res.ok) {
    throw new Error(`Direct media upload failed with status ${res.status}`);
  }
}
