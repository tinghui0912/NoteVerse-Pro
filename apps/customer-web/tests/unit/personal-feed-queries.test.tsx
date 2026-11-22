import { notificationQueryKeys } from '@/features/notifications/query-keys';
// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useMyNotifications } from '@/features/notifications/queries';
import { usePerformanceTakes } from '@/hooks/queries/use-performance-take-queries';
import { notificationsApi } from '@/features/notifications/api';
import { performanceTakesApi } from '@/lib/api/performance-takes';
import { notificationsChanged } from '@/features/notifications/cache';
vi.mock('@/features/notifications/api', () => ({ notificationsApi: { list: vi.fn() } }));
vi.mock('@/lib/api/performance-takes', () => ({ performanceTakesApi: { listTakes: vi.fn() } }));
afterEach(() => vi.clearAllMocks());
function context() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  return { client, wrapper: ({children}: {children: ReactNode}) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}
it('requests notification continuations only on demand and preserves loaded pages', async () => {
  const {client, wrapper} = context();
  const notification = (id: string) => ({ notification_id: id, kind: 'import.failed' as const, job_id: id, import_display_title: null, created_at: '2026-11-18T00:00:00Z', read_at: null });
  vi.mocked(notificationsApi.list).mockImplementation(async params => ({ items: [notification(params?.cursor ? 'later' : 'first')], next_cursor: params?.cursor ? null : 'notification-next' }));
  const hook = renderHook(() => useMyNotifications(), {wrapper});
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(notificationsApi.list).toHaveBeenCalledTimes(1);
  expect(hook.result.current.hasNextPage).toBe(true);
  await act(async () => { await hook.result.current.fetchNextPage(); });
  await waitFor(() => expect(hook.result.current.data?.pages).toHaveLength(2));
  expect(hook.result.current.data?.pages.flatMap(page => page.items).map(row => row.notification_id)).toEqual(['first', 'later']);
  expect(vi.mocked(notificationsApi.list).mock.calls[1][0]).toEqual({limit: 50, cursor: 'notification-next'});
  expect(hook.result.current.hasNextPage).toBe(false);
  hook.unmount();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  await notificationsChanged(client);
  expect(invalidate).toHaveBeenCalledWith({queryKey: notificationQueryKeys.list()});
  expect(invalidate).toHaveBeenCalledWith({queryKey: notificationQueryKeys.unreadCount()});
  client.clear();
});
it('uses take continuation and score filter without random-page parameters', async () => {
  const {client, wrapper} = context();
  vi.mocked(performanceTakesApi.listTakes).mockImplementation(async params => ({items: [], next_cursor: params?.cursor ? null : 'take-next'}));
  const hook = renderHook(() => usePerformanceTakes({score_id: 'score', limit: 20}), {wrapper});
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(performanceTakesApi.listTakes).toHaveBeenCalledTimes(1);
  expect(hook.result.current.hasNextPage).toBe(true);
  await act(async () => { await hook.result.current.fetchNextPage(); });
  expect(vi.mocked(performanceTakesApi.listTakes).mock.calls[1][0]).toEqual({score_id: 'score', limit: 20, cursor: 'take-next'});
  await waitFor(() => expect(hook.result.current.data?.pages).toHaveLength(2));
  expect(hook.result.current.hasNextPage).toBe(false);
  hook.unmount(); client.clear();
});

it('keeps loaded notifications on continuation failure and permits explicit retry', async () => {
  const {client, wrapper} = context();
  let failNext = true;
  vi.mocked(notificationsApi.list).mockImplementation(async params => {
    if (params?.cursor && failNext) throw new Error('continuation unavailable');
    return {items: [], next_cursor: params?.cursor ? null : 'retry-next'};
  });
  const hook = renderHook(() => {
    const query = useMyNotifications();
    return {data: query.data, isSuccess: query.isSuccess, isFetchNextPageError: query.isFetchNextPageError, fetchNextPage: query.fetchNextPage};
  }, {wrapper});
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  await act(async () => { await hook.result.current.fetchNextPage(); });
  await waitFor(() => expect(hook.result.current.isFetchNextPageError).toBe(true));
  expect(hook.result.current.data?.pages).toHaveLength(1);
  expect(notificationsApi.list).toHaveBeenCalledTimes(2);
  failNext = false;
  await act(async () => { await hook.result.current.fetchNextPage(); });
  await waitFor(() => expect(hook.result.current.data?.pages).toHaveLength(2));
  hook.unmount(); client.clear();
});
