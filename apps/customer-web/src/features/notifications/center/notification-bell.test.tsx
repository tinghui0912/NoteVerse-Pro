// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NotificationBell } from './notification-bell';

const data = vi.hoisted(() => ({ pending: 0, unread: 0, more: false,
  pendingQuery: vi.fn(), unreadQuery: vi.fn() }));
vi.mock('@/features/scores/collaboration/queries', () => ({
  useMyPendingScoreInvites: (enabled: boolean) => {
    data.pendingQuery(enabled);
    return { data: { pages: [{ items: Array.from({length: data.pending}) }] }, hasNextPage: data.more };
  },
}));
vi.mock('../queries', () => ({
  useNotificationUnreadCount: (enabled: boolean) => {
    data.unreadQuery(enabled);
    return { data: { count: data.unread } };
  },
}));
vi.mock('./notification-center-dialog', () => ({
  NotificationCenterDialog: ({open}: {open: boolean}) => open ? <div role="dialog">Center</div> : null,
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
beforeEach(() => { vi.clearAllMocks(); });

it.each([
  [0, 0, false, null],
  [2, 3, false, '5'],
  [99, 0, false, '99'],
  [100, 0, false, '99+'],
  [99, 1, false, '99+'],
  [1, 0, true, '99+'],
] as const)('combines %i pending and %i unread with continuation=%s', (pending, unread, more, badge) => {
  Object.assign(data, { pending, unread, more });
  render(<NotificationBell />);
  const bell = screen.getByRole('button', {name: 'bellLabel'});
  if (badge) expect(within(bell).getByText(badge)).toBeVisible();
  else expect(bell.querySelector('span')).toBeNull();
  expect(data.pendingQuery).toHaveBeenCalledWith(true);
  expect(data.unreadQuery).toHaveBeenCalledWith(true);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(bell);
  expect(screen.getByRole('dialog')).toBeVisible();
});
