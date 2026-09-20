'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  performanceTakesApi,
  uploadMediaToSignedUrl,
  type PerformanceTakeCreateRequest,
  type PerformanceTakeUploadAuthorizationRequest,
} from '@/lib/api/performance-takes';
import { queryKeys } from '@/lib/query-client';

export function usePerformanceTakes(
  params?: { score_id?: number; limit?: number; offset?: number },
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.performanceTakes.list(params),
    queryFn: ({ signal }) => performanceTakesApi.listTakes(params, signal),
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
  scoreId: number;
  revisionId?: number | null;
  artifactId?: string | null;
  clientRequestId: string;
  audioBlob: Blob;
  mimeType: string;
  durationMs: number;
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
      await uploadMediaToSignedUrl(
        authData.upload_url,
        authData.upload_method,
        authData.upload_headers,
        input.audioBlob
      );

      // 3. Finalize take
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
        scope_start_beat: input.scopeStartBeat,
        scope_terminal_beat: input.scopeTerminalBeat,
        tempo_selection: input.tempoSelection,
        resolved_tempo_plan: input.resolvedTempoPlan,
        sync_metadata: input.syncMetadata,
      };

      const finalizeRes = await performanceTakesApi.finalizeTake(finalizeReq);
      return finalizeRes.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.performanceTakes.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.storageUsage.all });
    },
  });
}
