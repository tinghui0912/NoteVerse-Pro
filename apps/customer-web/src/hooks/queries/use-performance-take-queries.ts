'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  performanceTakesApi,
  uploadMediaToSignedUrl,
  type PerformanceTakeCreateRequest,
  type PerformanceTakeUploadAuthorizationRequest,
} from '@/lib/api/performance-takes';
import { queryKeys } from '@/lib/query-client';

export function usePerformanceTakes(
  params?: { score_id?: string; limit?: number; offset?: number },
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.performanceTakes.list(params),
    queryFn: ({ signal }) => performanceTakesApi.listTakes(params, signal),
    enabled,
  });
}

export function useInfinitePerformanceTakes(
  params?: { score_id?: string },
  enabled = true
) {
  return useInfiniteQuery({
    queryKey: queryKeys.performanceTakes.list(params),
    queryFn: ({ pageParam = 0, signal }) =>
      performanceTakesApi.listTakes(
        { ...params, limit: 50, offset: pageParam as number },
        signal
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const data = lastPage.data;
      if (!data || !data.has_more) return undefined;
      const loadedCount = allPages.reduce(
        (acc, p) => acc + (p.data?.items.length ?? 0),
        0
      );
      return loadedCount;
    },
    enabled,
  });
}

export function usePerformanceTakeDetail(takeId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.performanceTakes.detail(takeId),
    queryFn: ({ signal }) => performanceTakesApi.getTake(takeId, signal),
    enabled: enabled && Boolean(takeId),
  });
}

export function usePerformanceTakePlayback(takeId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.performanceTakes.playbackUrl(takeId),
    queryFn: ({ signal }) => performanceTakesApi.getPlaybackUrl(takeId, signal),
    enabled: enabled && Boolean(takeId),
  });
}

export function useDeletePerformanceTake() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (takeId: string) => performanceTakesApi.deleteTake(takeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.performanceTakes.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.storageUsage.all });
    },
  });
}

export interface SavePerformanceTakeInput {
  scoreId: string;
  revisionId?: string | null;
  artifactId?: string | null;
  clientRequestId: string;
  audioBlob: Blob;
  mimeType: string;
  durationMs: number;
  scopeType?: string;
  scopeStartBeat: number;
  scopeTerminalBeat: number;
  tempoSelection?: Record<string, unknown> | null;
  resolvedTempoPlan?: Record<string, unknown> | null;
  syncMetadata?: Record<string, unknown> | null;
}

export function useSavePerformanceTake() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SavePerformanceTakeInput) => {
      // 1. Authorize upload
      const authReq: PerformanceTakeUploadAuthorizationRequest = {
        score_id: input.scoreId,
        revision_id: input.revisionId,
        artifact_id: input.artifactId,
        client_request_id: input.clientRequestId,
        media_byte_size: input.audioBlob.size,
        media_mime_type: input.mimeType,
        duration_ms: input.durationMs,
        scope_type: input.scopeType ?? 'FULL',
        scope_start_beat: input.scopeStartBeat,
        scope_terminal_beat: input.scopeTerminalBeat,
        tempo_selection: input.tempoSelection,
        resolved_tempo_plan: input.resolvedTempoPlan,
        sync_metadata: input.syncMetadata,
      };

      const authRes = await performanceTakesApi.authorizeUpload(authReq);
      const authData = authRes.data;
      if (!authData) {
        throw new Error('Failed to authorize performance take upload');
      }

      // 2. Direct upload binary to signed URL
      try {
        await uploadMediaToSignedUrl(
          authData.upload_url,
          authData.upload_method,
          authData.upload_headers,
          input.audioBlob
        );
      } catch (uploadErr) {
        try {
          await performanceTakesApi.cancelUploadAuthorization(authData.reservation_id);
        } catch {
          // ignore cancel error
        }
        throw uploadErr;
      }

      // 3. Finalize take request shape
      const finalizeReq: PerformanceTakeCreateRequest = {
        take_id: authData.take_id,
        client_request_id: input.clientRequestId,
        reservation_id: authData.reservation_id,
        score_id: input.scoreId,
        revision_id: input.revisionId,
        artifact_id: input.artifactId,
        media_byte_size: input.audioBlob.size,
        media_mime_type: input.mimeType,
        duration_ms: input.durationMs,
        scope_type: input.scopeType ?? 'FULL',
        scope_start_beat: input.scopeStartBeat,
        scope_terminal_beat: input.scopeTerminalBeat,
        tempo_selection: input.tempoSelection,
        resolved_tempo_plan: input.resolvedTempoPlan,
        sync_metadata: input.syncMetadata,
      };

      try {
        const finalizeRes = await performanceTakesApi.finalizeTake(finalizeReq);
        return finalizeRes.data;
      } catch (finalizeErr: any) {
        // Only cancel if deterministic non-retryable 4xx (e.g. 400, 401, 403, 404, 422);
        // if timeout, network disconnect, or 5xx, keep auth for safe user retry.
        const status =
          finalizeErr?.status ??
          finalizeErr?.response?.status ??
          finalizeErr?.response?.data?.status;
        const isDeterministic4xx =
          typeof status === 'number' &&
          status >= 400 &&
          status < 500 &&
          status !== 408 &&
          status !== 429;

        if (isDeterministic4xx) {
          try {
            await performanceTakesApi.cancelUploadAuthorization(authData.reservation_id);
          } catch {
            // ignore cancel error
          }
        }
        throw finalizeErr;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.performanceTakes.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.storageUsage.all });
    },
  });
}
