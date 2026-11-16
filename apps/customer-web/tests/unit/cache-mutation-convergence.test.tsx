// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useUpdateScore } from '@/hooks/queries/use-score-queries';
import { useConfirmImportJobReview } from '@/hooks/queries/use-review-queries';
import { useMarkNotificationRead } from '@/hooks/queries/use-notification-queries';
import { queryKeys as keys } from '@/lib/query-client';
import type { ScoreRead, NotificationRead } from '@/generated/api';

const api = vi.hoisted(() => ({ update: vi.fn(), confirm: vi.fn(), markRead: vi.fn() }));
vi.mock('@/lib/api', () => ({ scoresApi: { update: api.update }, reviewApi: { confirm: api.confirm }, notificationsApi: { markRead: api.markRead } }));
let client: QueryClient;
beforeEach(() => { vi.resetAllMocks(); client = new QueryClient({ defaultOptions: { mutations: { retry: false } } }); });
afterEach(() => client.clear());
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const score: ScoreRead = {
  score_id: 'score', display_title: 'New title', version: 2, genres: [], metadata: null, input_assets: [], head_revision_id: 'r1',
  created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
  capabilities: { can_view: true, can_edit: true, can_delete: true, can_leave: false, can_download: true, can_practice: true, can_manage_members: true, can_manage_guest_previews: true },
  derived_assets: { preview: { status: 'pending', asset_id: null }, audio: { status: 'pending', asset_id: null } },
};

it('converges successful Score PATCH into detail and Library before mutateAsync resolves', async () => {
  const list = keys.library.scoreList({ page: 1, pageSize: 20 });
  client.setQueryData(list, { items: [] }); api.update.mockResolvedValue(score);
  const hook = renderHook(() => useUpdateScore(), { wrapper });
  await act(async () => { await hook.result.current.mutateAsync({ scoreId: 'score', display_title: 'New title', expected_version: 1 }); });
  expect(client.getQueryData(keys.scores.detail('score'))).toEqual(score);
  expect(client.getQueryState(list)?.isInvalidated).toBe(true);
  expect(api.update).toHaveBeenCalledWith('score', { display_title: 'New title', expected_version: 1 });
  hook.unmount();
});

it('converges a local confirmation through Import, Review, Library, Score and storage', async () => {
  const changed = [keys.importJobs.list(1, 20), keys.importJobs.detail('job'), keys.review.detail('job'), keys.library.scoreList({ page: 1, pageSize: 20 }), keys.scores.detail('score'), keys.storageUsage.current()];
  changed.forEach((key) => client.setQueryData(key, { cached: true }));
  api.confirm.mockResolvedValue({ score_id: 'score' });
  const hook = renderHook(() => useConfirmImportJobReview(), { wrapper });
  await act(async () => { await hook.result.current.mutateAsync({ jobId: 'job', content: '<score-partwise/>' }); });
  expect(changed.map((key) => client.getQueryState(key)?.isInvalidated)).toEqual(Array(6).fill(true));
  hook.unmount();
});

it('restores optimistic notification snapshots on command failure then marks them stale', async () => {
  const notification: NotificationRead = { notification_id: 'notice', kind: 'import.failed', job_id: 'job', import_display_title: null, read_at: null, created_at: '2026-07-01T00:00:00Z' };
  const list = [notification]; client.setQueryData(keys.notifications.list(), list);
  client.setQueryData(keys.notifications.unreadCount(), { count: 1 });
  api.markRead.mockRejectedValue(new Error('Unavailable'));
  const hook = renderHook(() => useMarkNotificationRead(), { wrapper });
  await act(async () => { await expect(hook.result.current.mutateAsync('notice')).rejects.toThrow('Unavailable'); });
  expect(client.getQueryData(keys.notifications.list())).toEqual(list);
  expect(client.getQueryData(keys.notifications.unreadCount())).toEqual({ count: 1 });
  expect(client.getQueryState(keys.notifications.list())?.isInvalidated).toBe(true);
  expect(client.getQueryState(keys.notifications.unreadCount())?.isInvalidated).toBe(true);
  hook.unmount();
});
