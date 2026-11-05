'use client';

import { releaseRecordingMedia } from '@/lib/practice/recording/recording-media-resource';
import type { RecordingMediaResource } from '@/lib/practice/recording/recording-sink';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  performanceTakesApi,
  uploadMediaToSignedUrl,
  type RecordingTimebase,
  type PerformanceTakeRead,
  type PerformanceTakeUploadReservationRead,
  type PerformanceTakeTempoPlan,
  type PerformanceTakeUploadReservationRequest,
} from '@/lib/api/performance-takes';
import { normalizeCaptureMime, type CaptureMediaKind } from '@/lib/practice/recording/media-policy';
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
  mediaKind: CaptureMediaKind;
  mediaBlob: Blob;
  mediaResource: RecordingMediaResource;
  mimeType: string;
  durationMs: number;
  scope:
    | {
        kind: 'FULL';
        startTick: number;
        terminalTick: number;
      }
    | {
        kind: 'RANGE';
        startTick: number;
        terminalTick: number;
        startGroupId: string;
        endGroupId: string;
      };
  tempoPlan: PerformanceTakeTempoPlan;
  recordingTimebase: RecordingTimebase;
}

export function useSavePerformanceTake() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (input: SavePerformanceTakeInput) => {
      const request: PerformanceTakeUploadReservationRequest = {
        client_request_id: input.clientRequestId,
        source: {
          source_id: input.sourceId,
        },
        media: {
          kind: input.mediaKind,
          byte_size: input.mediaBlob.size,
          mime_type: normalizeCaptureMime(input.mimeType),
          duration_ms: input.durationMs,
        },
        scope: input.scope.kind === 'RANGE'
          ? {
              kind: 'RANGE',
              start_group_id: input.scope.startGroupId,
              end_group_id: input.scope.endGroupId,
            }
          : {
              kind: 'FULL',
            },
        tempo_selection: input.tempoPlan.selection,
        recording_timebase: input.recordingTimebase,
      };
      const response = await performanceTakesApi.reserveUpload(request);
      const reservation = response.data;
      if (!reservation) throw new Error('Upload reservation is unavailable');
      if (!reservationMatchesExecution(reservation, input)) {
        if (reservation.status === 'RESERVED') {
          try {
            await performanceTakesApi.cancelUploadReservation(reservation.reservation_id);
          } catch {
            // Expiry processing retains cleanup ownership if cancellation is unavailable.
          }
        }
        throw new Error('PERFORMANCE_TAKE_PLAN_MISMATCH');
      }
      if (reservation.status === 'COMPLETED') {
        if (!reservation.take) throw new Error('Completed reservation has no saved take');
        assertTakeMatchesExecution(reservation.take, input);
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
      assertTakeMatchesExecution(finalized.data, input);
      return finalized.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.performanceTakes.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.storageUsage.all });
    },
  });
  return {
    async mutateAsync(input: SavePerformanceTakeInput) {
      // Retain synchronously with the command, before React Query can schedule transport.
      const lease = input.mediaResource.retain();
      try { return await mutation.mutateAsync(input); }
      finally { await releaseRecordingMedia(lease); }
    },
  };
}

function tempoMatchesExecution(
  actual: PerformanceTakeTempoPlan | undefined,
  expected: PerformanceTakeTempoPlan,
): boolean {
  if (!actual?.selection || !Array.isArray(actual.segments)) return false;
  if (actual.selection.mode !== expected.selection.mode) return false;
  if (
    expected.selection.mode === 'CUSTOM_FIXED_BPM' &&
    (actual.selection.mode !== 'CUSTOM_FIXED_BPM' || actual.selection.bpm !== expected.selection.bpm)
  ) return false;
  return actual.segments.length === expected.segments.length &&
    actual.segments.every((segment, index) => {
      const executed = expected.segments[index];
      return segment?.startTick === executed.startTick &&
        segment.bpm === executed.bpm && segment.source === executed.source;
    });
}

function reservationMatchesExecution(
  reservation: PerformanceTakeUploadReservationRead,
  input: SavePerformanceTakeInput,
): boolean {
  const scope = reservation.resolved_scope;
  return reservation.metadata?.source?.source_id === input.sourceId && Boolean(scope) &&
    scope.kind === input.scope.kind && scope.start_tick === input.scope.startTick &&
    scope.terminal_tick === input.scope.terminalTick &&
    (input.scope.kind !== 'RANGE' || (scope.kind === 'RANGE' &&
      scope.start_group_id === input.scope.startGroupId && scope.end_group_id === input.scope.endGroupId)) &&
    tempoMatchesExecution(reservation.resolved_tempo_plan, input.tempoPlan);
}

function assertTakeMatchesExecution(
  take: PerformanceTakeRead | undefined,
  input: SavePerformanceTakeInput,
): asserts take is PerformanceTakeRead {
  if (
    !take || take.source_id !== input.sourceId || take.scope_type !== input.scope.kind ||
    take.scope_start_tick !== input.scope.startTick || take.scope_terminal_tick !== input.scope.terminalTick ||
    (input.scope.kind === 'RANGE' && (take.scope_start_group_id !== input.scope.startGroupId ||
      take.scope_end_group_id !== input.scope.endGroupId)) ||
    !tempoMatchesExecution(take.tempo_plan, input.tempoPlan)
  ) {
    throw new Error('PERFORMANCE_TAKE_PLAN_MISMATCH');
  }
}
