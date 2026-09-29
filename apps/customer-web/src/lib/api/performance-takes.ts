import { apiClient, apiUrl, type ApiResponse } from '@/lib/api-client';
import type {
  PerformanceTakeCreateRequest,
  PerformanceTakeDeleteResponse,
  PerformanceTakeListResponse,
  PerformanceTakePlaybackRead,
  PerformanceTakeRead,
  PerformanceTakeSyncMetadata,
  PerformanceTakeUploadAuthorizationRead,
  PerformanceTakeUploadAuthorizationRequest,
  ResolvedTempoPlan,
} from '@/generated/api/types.gen';

export const MAX_PERFORMANCE_TAKE_MEDIA_BYTES = 100 * 1024 * 1024;

export type {
  PerformanceTakeCreateRequest,
  PerformanceTakeDeleteResponse,
  PerformanceTakeListResponse,
  PerformanceTakePlaybackRead,
  PerformanceTakeRead,
  PerformanceTakeSyncMetadata,
  PerformanceTakeUploadAuthorizationRead,
  PerformanceTakeUploadAuthorizationRequest,
  ResolvedTempoPlan,
};

export const performanceTakesApi = {
  authorizeUpload: (request: PerformanceTakeUploadAuthorizationRequest, signal?: AbortSignal) =>
    apiClient.post<ApiResponse<PerformanceTakeUploadAuthorizationRead>>(
      '/performance-takes/upload-authorizations',
      request,
      { signal }
    ),

  cancelUploadAuthorization: (reservationId: string) =>
    apiClient.delete<ApiResponse<{ cancelled: boolean }>>(
      `/performance-takes/upload-authorizations/${reservationId}`
    ),

  finalizeTake: (request: PerformanceTakeCreateRequest, signal?: AbortSignal) =>
    apiClient.post<ApiResponse<PerformanceTakeRead>>('/performance-takes', request, { signal }),

  listTakes: (params?: { score_id?: string; limit?: number; offset?: number }, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<PerformanceTakeListResponse>>('/performance-takes', params, { signal }),

  getTake: (takeId: string, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<PerformanceTakeRead>>(`/performance-takes/${takeId}`, undefined, { signal }),

  getPlaybackUrl: (takeId: string, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<PerformanceTakePlaybackRead>>(
      `/performance-takes/${takeId}/playback-url`,
      undefined,
      { signal }
    ),
  downloadMediaBlob: (
    takeId: string,
    options?: {
      signal?: AbortSignal;
      onProgress?: (loadedBytes: number, totalBytes: number | null) => void;
    }
  ) => downloadPerformanceTakeMediaBlob(takeId, options),

  deleteTake: (takeId: string) =>
    apiClient.delete<ApiResponse<PerformanceTakeDeleteResponse>>(`/performance-takes/${takeId}`),
};

export async function downloadPerformanceTakeMediaBlob(
  takeId: string,
  options?: {
    signal?: AbortSignal;
    onProgress?: (loadedBytes: number, totalBytes: number | null) => void;
  }
): Promise<Blob> {
  const response = await apiClient.getRaw(
    `/performance-takes/${encodeURIComponent(takeId)}/media`,
    undefined,
    { signal: options?.signal }
  );
  const contentLength = response.headers.get('content-length');
  const total = contentLength ? Number(contentLength) : Number.NaN;
  const totalBytes =
    Number.isFinite(total) && total > 0 && total <= MAX_PERFORMANCE_TAKE_MEDIA_BYTES
      ? total
      : null;
  if (Number.isFinite(total) && total > MAX_PERFORMANCE_TAKE_MEDIA_BYTES) {
    throw new Error('historical_media_too_large');
  }
  if (!response.body) {
    const blob = await response.blob();
    if (blob.size > MAX_PERFORMANCE_TAKE_MEDIA_BYTES) {
      throw new Error('historical_media_too_large');
    }
    options?.onProgress?.(blob.size, totalBytes ?? blob.size);
    return blob;
  }

  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let loaded = 0;
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (loaded + value.byteLength > MAX_PERFORMANCE_TAKE_MEDIA_BYTES) {
        throw new Error('historical_media_too_large');
      }
      chunks.push(value as unknown as BlobPart);
      loaded += value.byteLength;
      options?.onProgress?.(loaded, totalBytes);
    }
    completed = true;
  } finally {
    if (!completed) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
  const blob = new Blob(chunks, {
    type: response.headers.get('content-type') ?? 'application/octet-stream',
  });
  options?.onProgress?.(loaded, totalBytes);
  return blob;
}

export async function uploadMediaToSignedUrl(
  uploadUrl: string,
  method: string,
  headers: Record<string, string>,
  body: Blob | ArrayBuffer
): Promise<void> {
  const isDirectOss = uploadUrl.startsWith('http://') || uploadUrl.startsWith('https://');
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
