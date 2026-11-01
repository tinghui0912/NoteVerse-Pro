'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  performanceTakesApi,
  uploadMediaToSignedUrl,
  type RecordingTimebase,
  type PerformanceTakeTempoPlan,
  type PerformanceTakeUploadReservationRequest,
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
  sourceId: string;
  clientRequestId: string;
  mediaKind: 'AUDIO' | 'VIDEO';
  mediaBlob: Blob;
  mimeType: string;
  durationMs: number;
  scope:
    | {
        kind: 'FULL';
        startBeat: number;
        terminalBeat: number;
      }
    | {
        kind: 'RANGE';
        startBeat: number;
        terminalBeat: number;
        startGroupId: string;
        endGroupId: string;
      };
  tempoPlan: PerformanceTakeTempoPlan;
  recordingTimebase: RecordingTimebase;
}

export function useSavePerformanceTake() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SavePerformanceTakeInput) => {
      const request: PerformanceTakeUploadReservationRequest = {
        client_request_id: input.clientRequestId,
        source: {
          source_id: input.sourceId,
        },
        media: {
          kind: input.mediaKind,
          byte_size: input.mediaBlob.size,
          mime_type: input.mimeType,
          duration_ms: input.durationMs,
        },
        scope: input.scope.kind === 'RANGE'
          ? {
              kind: 'RANGE',
              start_beat: input.scope.startBeat,
              terminal_beat: input.scope.terminalBeat,
              start_group_id: input.scope.startGroupId,
              end_group_id: input.scope.endGroupId,
            }
          : {
              kind: 'FULL',
              start_beat: input.scope.startBeat,
              terminal_beat: input.scope.terminalBeat,
            },
        tempo_plan: input.tempoPlan,
        recording_timebase: input.recordingTimebase,
      };
      const response = await performanceTakesApi.reserveUpload(request);
      const reservation = response.data;
      if (!reservation) throw new Error('Upload reservation is unavailable');
      if (reservation.status === 'COMPLETED') {
        if (!reservation.take) throw new Error('Completed reservation has no saved take');
        return reservation.take;
      }
      if (reservation.status === 'RESERVED') {
        const target = reservation.upload_target;
        if (!target) throw new Error('Reserved upload has no upload target');
        try {
          await uploadMediaToSignedUrl(target.url, target.method, target.headers, input.mediaBlob);
        } catch (error) {
          try {
            await performanceTakesApi.cancelUploadReservation(reservation.reservation_id);
          } catch {
            // Reservation expiry processing retains cleanup ownership.
          }
          throw error;
        }
      }
      // Unknown finalize outcomes retain the reservation for an idempotent retry.
      const finalized = await performanceTakesApi.finalizeTake(reservation.reservation_id);
      return finalized.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.performanceTakes.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.storageUsage.all });
    },
  });
}
