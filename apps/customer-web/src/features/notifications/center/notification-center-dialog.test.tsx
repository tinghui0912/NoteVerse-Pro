// @vitest-environment jsdom
import type { PropsWithChildren } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NotificationRead, PendingInviteRead } from '@/generated/api';
import { NotificationCenterDialog } from './notification-center-dialog';
import { NotificationBell } from './notification-bell';

const fake = vi.hoisted(() => ({
  push: vi.fn(), toast: vi.fn(), close: vi.fn(), authenticated: true,
  notifications: { list: vi.fn(), unreadCount: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn() },
  collaboration: { listMyPendingInvites: vi.fn(), acceptMyPendingInvite: vi.fn(), declineMyPendingInvite: vi.fn() },
}));
vi.mock('@/features/authentication/session/authentication-context', () => ({ useAuthentication: () => ({ isAuthenticated: fake.authenticated }) }));
vi.mock('@/features/notifications/api', () => ({ notificationsApi: fake.notifications }));
vi.mock('@/features/scores/collaboration/api', () => ({ collaborationApi: fake.collaboration }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({toast: fake.toast}) }));
vi.mock('@/i18n/routing', () => ({ routing: {defaultLocale: 'en'}, useRouter: () => ({push: fake.push}) }));
vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => (key: string) => key }));

const invite: PendingInviteRead = {
  invite_id: 'invite', score_id: 'score', score_display_title: 'Action Score',
  inviter: null, email: 'member@example.com', role: 'VIEWER', status: 'PENDING',
  created_at: '2026-11-22T00:00:00Z', expires_at: null,
};
const notice: NotificationRead = {
  notification_id: 'notice', kind: 'import.failed', job_id: 'job',
  import_display_title: 'History Import', created_at: '2026-11-22T00:00:00Z', read_at: null,
};
let client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  fake.authenticated = true;
  client = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
  fake.collaboration.listMyPendingInvites.mockResolvedValue({items: [invite], next_cursor: null});
  fake.notifications.list.mockResolvedValue({items: [notice], next_cursor: null});
  fake.notifications.unreadCount.mockResolvedValue({count: 1});
  vi.stubGlobal('ResizeObserver', class {observe() {} unobserve() {} disconnect() {}});
});
afterEach(() => { client.clear(); vi.unstubAllGlobals(); });
function show() {
  const wrapper = ({children}: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<NotificationCenterDialog open onOpenChange={fake.close} />, {wrapper});
}

it('reuses pending and unread server state from the Bell when opening the Center', async () => {
  client.setDefaultOptions({queries: {retry: false, staleTime: Infinity}});
  render(<QueryClientProvider client={client}><NotificationBell /></QueryClientProvider>);
  expect(await screen.findByText('2')).toBeVisible();
  expect(fake.notifications.list).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', {name: 'bellLabel'}));
  expect(await screen.findByText('Action Score')).toBeVisible();
  expect(await screen.findByText('History Import')).toBeVisible();
  expect(fake.collaboration.listMyPendingInvites).toHaveBeenCalledOnce();
  expect(fake.notifications.unreadCount).toHaveBeenCalledOnce();
  expect(fake.notifications.list).toHaveBeenCalledOnce();
});

it('accepts a Collaboration action, closes the center and opens its Score', async () => {
  fake.collaboration.acceptMyPendingInvite.mockResolvedValue({score_id: 'accepted-score', role: 'VIEWER', membership_id: 1});
  show();
  await userEvent.click(await screen.findByRole('button', {name: 'acceptInvite'}));
  await waitFor(() => expect(fake.push).toHaveBeenCalledWith('/score/accepted-score'));
  expect(fake.close).toHaveBeenCalledWith(false);
  expect(fake.collaboration.acceptMyPendingInvite).toHaveBeenCalledWith('invite');
  expect(fake.notifications.markRead).not.toHaveBeenCalled();
});

it('declines through Collaboration and refreshes actions while retaining history and the center', async () => {
  fake.collaboration.declineMyPendingInvite.mockImplementation(async () => {
    fake.collaboration.listMyPendingInvites.mockResolvedValue({items: [], next_cursor: null});
    return {...invite, status: 'DECLINED'};
  });
  show();
  await userEvent.click(await screen.findByRole('button', {name: 'declineInvite'}));
  await waitFor(() => expect(screen.queryByText('Action Score')).not.toBeInTheDocument());
  expect(fake.collaboration.declineMyPendingInvite).toHaveBeenCalledWith('invite');
  expect(screen.getByText('History Import')).toBeVisible();
  expect(fake.close).not.toHaveBeenCalled();
  expect(fake.push).not.toHaveBeenCalled();
  expect(fake.notifications.markRead).not.toHaveBeenCalled();
});

it.each(['actions', 'history'] as const)('keeps the other surface usable when %s fails', async (surface) => {
  if (surface === 'actions') fake.collaboration.listMyPendingInvites.mockRejectedValue(new Error('offline'));
  else fake.notifications.list.mockRejectedValue(new Error('offline'));
  show();
  expect(await screen.findByText(surface === 'actions' ? 'loadActionsFailed' : 'loadUpdatesFailed')).toBeVisible();
  expect(await screen.findByText(surface === 'actions' ? 'History Import' : 'Action Score')).toBeVisible();
  if (surface === 'history') expect(screen.getByRole('button', {name: 'acceptInvite'})).toBeEnabled();
});

it('loads action and history continuations independently and requests 100 pending actions', async () => {
  fake.collaboration.listMyPendingInvites.mockImplementation(async ({cursor}) => ({
    items: [{...invite, invite_id: cursor ? 'second-invite' : 'invite', score_display_title: cursor ? 'More Actions' : 'Action Score'}],
    next_cursor: cursor ? null : 'actions-next',
  }));
  fake.notifications.list.mockImplementation(async ({cursor}) => ({
    items: [{...notice, notification_id: cursor ? 'second-notice' : 'notice', import_display_title: cursor ? 'More History' : 'History Import'}],
    next_cursor: cursor ? null : 'history-next',
  }));
  show();
  await screen.findByText('History Import');
  const actions = screen.getByRole('heading', {name: 'actionRequired'}).closest('section')!;
  const history = screen.getByRole('heading', {name: 'updates'}).closest('section')!;
  expect(fake.collaboration.listMyPendingInvites.mock.calls[0][0]).toMatchObject({limit: 100});
  expect(fake.notifications.list).toHaveBeenCalledOnce();
  await userEvent.click(await within(actions).findByRole('button', {name: 'loadMore'}));
  expect(await screen.findByText('More Actions')).toBeVisible();
  expect(fake.notifications.list).toHaveBeenCalledOnce();
  await userEvent.click(within(history).getByRole('button', {name: 'loadMore'}));
  expect(await screen.findByText('More History')).toBeVisible();
  expect(fake.collaboration.listMyPendingInvites).toHaveBeenCalledTimes(2);
  expect(fake.notifications.list).toHaveBeenCalledTimes(2);
});

it.each([true, false])('opens history even if the read-state write fails (already read=%s)', async (read) => {
  fake.notifications.list.mockResolvedValue({items: [{...notice, read_at: read ? '2026-11-22T01:00:00Z' : null}], next_cursor: null});
  fake.notifications.markRead.mockRejectedValue(new Error('offline'));
  show();
  await userEvent.click(await screen.findByRole('button', {name: /History Import/}));
  await waitFor(() => expect(fake.push).toHaveBeenCalledWith('/upload#import-activity'));
  expect(fake.close).toHaveBeenCalledWith(false);
  expect(fake.notifications.markRead).toHaveBeenCalledTimes(read ? 0 : 1);
});


it('waits for the authenticated principal before starting private Bell queries', async () => {
  fake.authenticated = false;
  const {rerender} = render(<QueryClientProvider client={client}><NotificationBell /></QueryClientProvider>);
  expect(fake.collaboration.listMyPendingInvites).not.toHaveBeenCalled();
  expect(fake.notifications.unreadCount).not.toHaveBeenCalled();
  fake.authenticated = true;
  rerender(<QueryClientProvider client={client}><NotificationBell /></QueryClientProvider>);
  expect(await screen.findByText('2')).toBeVisible();
  expect(fake.collaboration.listMyPendingInvites).toHaveBeenCalledOnce();
  expect(fake.notifications.unreadCount).toHaveBeenCalledOnce();
});
