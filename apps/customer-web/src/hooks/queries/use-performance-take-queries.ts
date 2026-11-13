'use client';
import { recordedPerformance } from '@/lib/practice/recording/recorded-performance';
import {
performanceTakeUploadRequest,
savedTakeAgreesWithRecordedPerformance,
takeManifestAgreesWithRecordedPerformance,
type SavePerformanceTakeInput,
} from '@/lib/practice/saved-take/save';

import { releaseLocalMediaAsset } from '@/lib/practice/media/local-media-asset';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { PerformanceTakeGetResponse, PerformanceTakesListResponse } from '@/generated/api';
import {
performanceTakesApi
} from '@/lib/api/performance-takes';
import { uploadMediaToSignedUrl } from '@/lib/http/direct-object-upload';
import { queryKeys } from '@/lib/query-client';

export function usePerformanceTakes(
  params?: { score_id?: string; limit?: number; offset?: number },
  enabled = true,
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
    onSuccess: async (_response, takeId) => {
      await Promise.all([
        queryClient.cancelQueries({
          queryKey: queryKeys.performanceTakes.lists(),
        }),
        queryClient.cancelQueries({
          queryKey: queryKeys.performanceTakes.detail(takeId),
          exact: true,
        }),
        queryClient.cancelQueries({
          queryKey: queryKeys.performanceTakes.playbackUrl(takeId),
          exact: true,
        }),
      ]);
      const lists = queryClient.getQueriesData<
        PerformanceTakesListResponse
      >({
        queryKey: queryKeys.performanceTakes.lists(),
      });
      const take =
        queryClient.getQueryData<PerformanceTakeGetResponse>(
          queryKeys.performanceTakes.detail(takeId),
        )?.data ??
        lists
          .flatMap(([, value]) => value?.data?.items ?? [])
          .find((item) => item.take_id === takeId);
      const matchingScoreFilters = new Set(
        lists.flatMap(([key, value]) => {
          const filter = (key[2] ?? {}) as { score_id?: string };
          return filter.score_id &&
            value?.data?.items.some((item) => item.take_id === takeId)
            ? [filter.score_id]
            : [];
        }),
      );
      for (const [key] of lists) {
        const filter = (key[2] ?? {}) as { score_id?: string };
        const belongs =
          !filter.score_id ||
          filter.score_id === take?.linked_score_id ||
          matchingScoreFilters.has(filter.score_id);
        queryClient.setQueryData<PerformanceTakesListResponse>(
          key,
          (previous) => {
            if (!previous?.data) return previous;
            const data = previous.data;
            const items = data.items.filter((item) => item.take_id !== takeId);
            const total = Math.max(
              0,
              data.total -
                (belongs || items.length !== data.items.length ? 1 : 0),
            );
            return {
              ...previous,
              data: {
                ...data,
                items,
                total,
                has_more: (data.offset ?? 0) + items.length < total,
              },
            };
          },
        );
      }
      queryClient.removeQueries({
        queryKey: queryKeys.performanceTakes.detail(takeId),
        exact: true,
      });
      queryClient.removeQueries({
        queryKey: queryKeys.performanceTakes.playbackUrl(takeId),
        exact: true,
      });
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.performanceTakes.lists(),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.storageUsage.all }),
      ]);
    },
  });
}

export function useSavePerformanceTake() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (input: SavePerformanceTakeInput) => {
      const request = performanceTakeUploadRequest(input);
      const response = await performanceTakesApi.reserveUpload(request);
      const reservation = response.data;
      if (!reservation) throw new Error('Upload reservation is unavailable');
      if (
        !takeManifestAgreesWithRecordedPerformance(
          reservation.manifest,
          input.recordedPerformance,
        )
      ) {
        if (reservation.status === 'RESERVED') {
          try {
            await performanceTakesApi.cancelUploadReservation(
              reservation.reservation_id,
            );
          } catch {
            // Expiry processing retains cleanup ownership if cancellation is unavailable.
          }
        }
        throw new Error('PERFORMANCE_TAKE_PLAN_MISMATCH');
      }
      if (reservation.status === 'COMPLETED') {
        if (!reservation.take)
          throw new Error('Completed reservation has no saved take');
        if (
          !takeManifestAgreesWithRecordedPerformance(
            reservation.take.manifest,
            input.recordedPerformance,
          ) ||
          !savedTakeAgreesWithRecordedPerformance(
            reservation.take,
            input.recordedPerformance,
          )
        )
          throw new Error('PERFORMANCE_TAKE_PLAN_MISMATCH');
        return reservation.take;
      }
      if (reservation.status === 'RESERVED') {
        const target = reservation.upload_target;
        if (!target) throw new Error('Reserved upload has no upload target');
        try {
          await uploadMediaToSignedUrl(
            target.url,
            target.method,
            target.headers,
            input.recordedPerformance.recording.media.blob,
          );
        } catch (error) {
          try {
            await performanceTakesApi.cancelUploadReservation(
              reservation.reservation_id,
            );
          } catch {
            // Reservation expiry processing retains cleanup ownership.
          }
          throw error;
        }
      }
      // Unknown finalize outcomes retain the reservation for an idempotent retry.
      const finalized = await performanceTakesApi.finalizeTake(
        reservation.reservation_id,
      );
      if (
        !finalized.data ||
        !takeManifestAgreesWithRecordedPerformance(
          finalized.data.manifest,
          input.recordedPerformance,
        ) ||
        !savedTakeAgreesWithRecordedPerformance(
          finalized.data,
          input.recordedPerformance,
        )
      )
        throw new Error('PERFORMANCE_TAKE_PLAN_MISMATCH');
      return finalized.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.performanceTakes.all,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.storageUsage.all });
    },
  });
  return {
    async mutateAsync(input: SavePerformanceTakeInput) {
      // Retain synchronously with the command, before React Query can schedule transport.
      const lease = input.recordedPerformance.recording.media.retain();
      try {
        return await mutation.mutateAsync({
          ...input,
          recordedPerformance: recordedPerformance(
            input.recordedPerformance.executed,
            Object.freeze({
              ...input.recordedPerformance.recording,
              media: lease,
            }),
          ),
        });
      } finally {
        await releaseLocalMediaAsset(lease);
      }
    },
  };
}
