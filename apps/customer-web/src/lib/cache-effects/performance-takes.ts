import type { QueryClient, InfiniteData } from '@tanstack/react-query';
import type { PerformanceTakesListResponse } from '@/generated/api';
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
  const lists = client.getQueriesData<InfiniteData<PerformanceTakesListResponse, string | undefined>>({
    queryKey: queryKeys.performanceTakes.lists(),
  });
  for (const [key] of lists) {
    client.setQueryData<InfiniteData<PerformanceTakesListResponse, string | undefined>>(key, (previous) => {
      if (!previous) return previous;
      return { ...previous, pages: previous.pages.map(page => ({
        ...page, items: page.items.filter(item => item.take_id !== takeId),
      })) };
    });
  }
  client.removeQueries({
    queryKey: queryKeys.performanceTakes.detail(takeId),
    exact: true,
  });
  client.removeQueries({
    queryKey: queryKeys.performanceTakes.playbackUrl(takeId),
    exact: true,
  });
  await Promise.all([
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
