// @vitest-environment jsdom
import React, { type PropsWithChildren } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NotificationCenterDialog } from '@/components/notifications/notification-center-dialog';
import { queryKeys } from '@/lib/query-client';

const api = vi.hoisted(() => ({list: vi.fn(), unreadCount: vi.fn(), markAllRead: vi.fn()}));
vi.mock('@/lib/api', () => ({notificationsApi: api}));
vi.mock('@/hooks/queries/use-score-queries', () => ({
  useMyPendingScoreInvites: () => ({data: {pages: [{items: []}]}}),
  useAcceptMyPendingScoreInvite: () => ({mutate: vi.fn()}),
  useDeclineMyPendingScoreInvite: () => ({mutate: vi.fn()}),
}));
vi.mock('@/hooks/use-toast', () => ({useToast: () => ({toast: vi.fn()})}));
vi.mock('@/i18n/routing', () => ({routing: {defaultLocale: 'en'}, useRouter: () => ({push: vi.fn()})}));
vi.mock('next-intl', () => ({useLocale: () => 'en', useTranslations: () => (key: string) => key}));
let client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
  vi.stubGlobal('ResizeObserver', class {observe() {} unobserve() {} disconnect() {}});
});
afterEach(() => {client.clear(); vi.unstubAllGlobals();});

it('offers global mark-all when the loaded window is read but unloaded history is unread', async () => {
  const read = {notification_id: 'read', kind: 'import.failed', job_id: 'job', import_display_title: null,
    read_at: '2026-07-01T01:00:00Z', created_at: '2026-07-01T00:00:00Z'};
  api.list.mockResolvedValue({items: [read], next_cursor: 'unloaded-history'});
  api.unreadCount.mockResolvedValue({count: 7});
  let complete!: () => void;
  api.markAllRead.mockImplementation(() => new Promise(resolve => {
    complete = () => {api.unreadCount.mockResolvedValue({count: 0}); resolve({count: 0});};
  }));
  const wrapper = ({children}: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<NotificationCenterDialog open onOpenChange={vi.fn()} />, {wrapper});
  const command = await screen.findByRole('button', {name: 'markAllRead'});
  expect(command).toBeEnabled();
  expect(api.list).toHaveBeenCalledOnce();
  await userEvent.click(command);
  await waitFor(() => expect(api.markAllRead).toHaveBeenCalledOnce());
  expect(client.getQueryData(queryKeys.notifications.unreadCount())).toEqual({count: 0});
  expect(screen.queryByRole('button', {name: 'markAllRead'})).not.toBeInTheDocument();
  complete();
  await waitFor(() => expect(api.unreadCount).toHaveBeenCalledTimes(2));
  expect(api.list.mock.calls.every(call => !call[0].cursor)).toBe(true);
  expect(screen.getByRole('button', {name: 'loadMore'})).toBeInTheDocument();
});

it('does not offer mark-all when the server collection unread count is zero', async () => {
  api.list.mockResolvedValue({items: [], next_cursor: null});
  api.unreadCount.mockResolvedValue({count: 0});
  const wrapper = ({children}: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<NotificationCenterDialog open onOpenChange={vi.fn()} />, {wrapper});
  await waitFor(() => expect(api.unreadCount).toHaveBeenCalledOnce());
  expect(screen.queryByRole('button', {name: 'markAllRead'})).not.toBeInTheDocument();
});
