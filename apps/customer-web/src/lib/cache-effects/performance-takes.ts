import type { QueryClient } from '@tanstack/react-query';
import type { PerformanceTakeGetResponse, PerformanceTakesListResponse } from '@/generated/api';
import { queryKeys } from '@/lib/query-client';
import { storageUsageChanged } from './storage';

export async function performanceTakeDeleted(client: QueryClient, takeId: string) {
  await Promise.all([
    client.cancelQueries({
      queryKey: queryKeys.performanceTakes.lists(),
    }),
    client.cancelQueries({
      queryKey: queryKeys.performanceTakes.detail(takeId),
      exact: true,
    }),
    client.cancelQueries({
      queryKey: queryKeys.performanceTakes.playbackUrl(takeId),
      exact: true,
    }),
  ]);
  const lists = client.getQueriesData<
    PerformanceTakesListResponse
  >({
    queryKey: queryKeys.performanceTakes.lists(),
  });
  const take =
    client.getQueryData<PerformanceTakeGetResponse>(
      queryKeys.performanceTakes.detail(takeId),
    ) ??
    lists
      .flatMap(([, value]) => value?.items ?? [])
      .find((item) => item.take_id === takeId);
  const matchingScoreFilters = new Set(
    lists.flatMap(([key, value]) => {
      const filter = (key[2] ?? {}) as { score_id?: string };
      return filter.score_id &&
        value?.items.some((item) => item.take_id === takeId)
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
    client.setQueryData<PerformanceTakesListResponse>(
      key,
      (previous) => {
        if (!previous) return previous;
        const data = previous;
        const items = data.items.filter((item) => item.take_id !== takeId);
        const total = Math.max(
          0,
          data.total -
            (belongs || items.length !== data.items.length ? 1 : 0),
        );
        return {
            ...data,
            items,
            total,
            has_more: (data.offset ?? 0) + items.length < total,
        };
      },
    );
  }
  client.removeQueries({
    queryKey: queryKeys.performanceTakes.detail(takeId),
    exact: true,
  });
  client.removeQueries({
    queryKey: queryKeys.performanceTakes.playbackUrl(takeId),
    exact: true,
  });
  void Promise.all([
    client.invalidateQueries({
      queryKey: queryKeys.performanceTakes.lists(),
    }),
    storageUsageChanged(client),
  ]);
}

export async function performanceTakeSaved(client: QueryClient) {
  await Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.performanceTakes.all }),
    storageUsageChanged(client),
  ]);
}
