// @vitest-environment jsdom
import React, { type PropsWithChildren } from 'react';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScoreCollaborationPanel } from '@/components/score-detail/score-collaboration-panel';
import { NotificationCenterDialog } from '@/components/notifications/notification-center-dialog';
import {
  useMyPendingScoreInvites,
  useScoreInvites,
  useScoreMembers,
} from '@/hooks/queries/use-score-queries';
import type { InviteRead, MemberRead, PendingInviteRead } from '@/generated/api';
import { queryKeys } from '@/lib/query-client';
import messages from '../../messages/en/scoreCollaboration.json';

const api = vi.hoisted(() => ({
  listInvites: vi.fn(),
  listMembers: vi.fn(),
  listMyPendingInvites: vi.fn(),
  createInvite: vi.fn(),
  revokeInvite: vi.fn(),
  updateMember: vi.fn(),
  removeMember: vi.fn(),
  acceptMyPendingInvite: vi.fn(),
  declineMyPendingInvite: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ scoreInvitesApi: api, scoresApi: {} }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/i18n/routing', () => ({
  routing: { defaultLocale: 'en' },
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string) => (key === 'invitations' ? 'Invitations' : key),
}));
vi.mock('@/hooks/queries/use-notification-queries', () => ({
  useMyNotifications: () => ({ data: [], isLoading: false, isError: false }),
  useMarkNotificationRead: () => ({ mutate: vi.fn(), isPending: false }),
  useMarkAllNotificationsRead: () => ({ mutate: vi.fn(), isPending: false }),
}));

const timestamp = '2026-11-13T00:00:00';
const invite = (id: string): InviteRead => ({
  invite_id: id,
  email: `${id}@example.com`,
  role: 'VIEWER',
  status: 'PENDING',
  created_at: timestamp,
  expires_at: null,
  terminal_at: null,
  created_by: null,
  terminal_actor: null,
});
const member = (id: number): MemberRead => ({
  membership_id: id,
  email: `member-${id}@example.com`,
  display_name: `Member ${id}`,
  avatar_url: null,
  role: 'VIEWER',
  created_at: timestamp,
  revoked_at: null,
});
const pending = (id: string): PendingInviteRead => ({
  invite_id: id,
  score_id: `score-${id}`,
  score_display_title: `Score ${id}`,
  inviter: null,
  email: 'me@example.com',
  role: 'VIEWER',
  status: 'PENDING',
  expires_at: null,
  created_at: timestamp,
});
const page = <T,>(items: T[], next_cursor: string | null = null) => ({ items, next_cursor });
function wrapper(
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  }),
) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  api.listInvites.mockResolvedValue(page([]));
  api.listMembers.mockResolvedValue(page([]));
  api.listMyPendingInvites.mockResolvedValue(page([]));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

describe('cursor query page ownership', () => {
  it.each(['invites', 'members', 'pending'] as const)(
    '%s continues only when requested',
    async (kind) => {
      const method =
        kind === 'invites'
          ? api.listInvites
          : kind === 'members'
            ? api.listMembers
            : api.listMyPendingInvites;
      const useCollection =
        kind === 'invites'
          ? () => useScoreInvites('score')
          : kind === 'members'
            ? () => useScoreMembers('score')
            : () => useMyPendingScoreInvites();
      method.mockResolvedValueOnce(page([], 'opaque-next')).mockResolvedValueOnce(page([]));
      const { result } = renderHook(() => useCollection(), { wrapper: wrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.hasNextPage).toBe(true);
      expect(method).toHaveBeenCalledTimes(1);
      await act(async () => {
        await result.current.fetchNextPage();
      });
      await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
      expect(method.mock.calls[1].at(-1)).toEqual(
        expect.objectContaining({ cursor: 'opaque-next' }),
      );
      expect(result.current.hasNextPage).toBe(false);
    },
  );
});

it('appends members and invites with explicit continuation and retains loaded content while fetching', async () => {
  let completeNext!: (value: ReturnType<typeof page<InviteRead>>) => void;
  api.listInvites
    .mockResolvedValueOnce(page([invite('first')], 'opaque-invites'))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeNext = resolve;
        }),
    );
  api.listMembers
    .mockResolvedValueOnce(page([member(1)], 'opaque-members'))
    .mockResolvedValueOnce(page([member(2)]));
  render(<ScoreCollaborationPanel scoreId="score" scoreDisplayTitle="Score" />, { wrapper: wrapper() });
  await screen.findByText('first@example.com');
  const invites = within(screen.getByRole('heading', { name: 'Invitations' }).closest('section')!);
  const members = within(screen.getByRole('heading', { name: 'members' }).closest('section')!);
  await userEvent.click(invites.getByRole('button', { name: 'loadMore' }));
  expect(invites.getByRole('button', { name: 'loadMore' })).toBeDisabled();
  expect(invites.getByText('first@example.com')).toBeInTheDocument();
  await act(async () => {
    completeNext(page([invite('second')]));
  });
  await screen.findByText('second@example.com');
  expect(screen.getAllByText('first@example.com')).toHaveLength(1);
  expect(invites.queryByRole('button', { name: 'loadMore' })).not.toBeInTheDocument();
  expect(api.listInvites.mock.calls[1][1].cursor).toBe('opaque-invites');
  await userEvent.click(members.getByRole('button', { name: 'loadMore' }));
  await screen.findByText('member-2@example.com');
  expect(screen.getAllByText('member-1@example.com')).toHaveLength(1);
  expect(members.queryByRole('button', { name: 'loadMore' })).not.toBeInTheDocument();
  expect(api.listMembers.mock.calls[1][1].cursor).toBe('opaque-members');
});

it('refreshes the invite collection after revoke', async () => {
  api.listInvites
    .mockResolvedValueOnce(page([invite('first')]))
    .mockResolvedValue(page([{ ...invite('first'), status: 'REVOKED' }]));
  api.revokeInvite.mockResolvedValue({ ...invite('first'), status: 'REVOKED' });
  render(<ScoreCollaborationPanel scoreId="score" scoreDisplayTitle="Score" />, { wrapper: wrapper() });
  await screen.findByText('first@example.com');
  await userEvent.click(screen.getByRole('button', { name: 'revoke' }));
  await waitFor(() => expect(api.listInvites).toHaveBeenCalledTimes(2));
  expect(await screen.findByText(/status.revoked/)).toBeInTheDocument();
});

it.each(['accept', 'decline'] as const)(
  'continues pending cards and rebuilds from the first page after %s',
  async (action) => {
    api.listMyPendingInvites
      .mockResolvedValueOnce(page([pending('first')], 'opaque-pending'))
      .mockResolvedValueOnce(page([pending('second')]))
      .mockResolvedValue(page([pending('second')]));
    api.declineMyPendingInvite.mockResolvedValue({ ...pending('first'), status: 'DECLINED' });
    api.acceptMyPendingInvite.mockResolvedValue({ score_id: 'score-first', role: 'VIEWER', membership_id: 1 });
    render(<NotificationCenterDialog open onOpenChange={vi.fn()} />, { wrapper: wrapper() });
    await screen.findByText('Score first');
    await userEvent.click(screen.getByRole('button', { name: 'loadMore' }));
    await screen.findByText('Score second');
    expect(screen.getAllByText('Score first')).toHaveLength(1);
    expect(api.listMyPendingInvites.mock.calls[1][0].cursor).toBe('opaque-pending');
    expect(screen.queryByRole('button', { name: 'loadMore' })).not.toBeInTheDocument();
    await userEvent.click(
      screen.getAllByRole('button', {
        name: action === 'accept' ? 'acceptInvite' : 'declineInvite',
      })[0],
    );
    await waitFor(() => expect(screen.queryByText('Score first')).not.toBeInTheDocument());
    expect(api.listMyPendingInvites.mock.calls[2][0].cursor).toBeUndefined();
    expect(screen.getAllByText('Score second')).toHaveLength(1);
  },
);

it.each(['ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED'] as const)(
  'offers no terminal invitation commands or token copy for %s',
  async (status) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    api.createInvite.mockResolvedValue({ ...invite('local'), token: 'local-raw-token' });
    api.listInvites.mockResolvedValue(page([invite('local')]));
    render(<ScoreCollaborationPanel scoreId="score" scoreDisplayTitle="Score" />, {
      wrapper: wrapper(client),
    });
    await screen.findByText('local@example.com');
    expect(screen.getByRole('heading', { name: messages.invitations })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'revoke' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'copy' })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('email'), 'local@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'createInvite' }));
    await screen.findByRole('button', { name: 'copy' });
    await waitFor(() => expect(client.isFetching({queryKey: queryKeys.scores.invites('score')})).toBe(0));
    // The local token remains in component state while the authoritative page changes.
    await act(async () => {
      client.setQueryData(queryKeys.scores.invites('score'), {
        pages: [page([{ ...invite('local'), status }])],
        pageParams: [undefined],
      });
    });
    expect(await screen.findByText(new RegExp(`status.${status.toLowerCase()}`))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'copy' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'revoke' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /delete|clear history|remove invitation/i }),
    ).not.toBeInTheDocument();
    client.clear();
  },
);

it('refreshes the members collection after removal', async () => {
  api.listMembers
    .mockResolvedValueOnce(page([member(1)]))
    .mockResolvedValue(page([{ ...member(1), revoked_at: timestamp }]));
  api.removeMember.mockResolvedValue({ ...member(1), revoked_at: timestamp });
  render(<ScoreCollaborationPanel scoreId="score" scoreDisplayTitle="Score" />, { wrapper: wrapper() });
  await screen.findByText('member-1@example.com');
  await userEvent.click(screen.getByRole('button', { name: 'remove' }));
  await waitFor(() => expect(api.listMembers).toHaveBeenCalledTimes(2));
  expect(screen.getByText('member-1@example.com')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'remove' })).toBeDisabled();
});
