import { notificationQueryKeys } from '@/features/notifications/query-keys';
import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { notificationReadOptimistically, allNotificationsReadOptimistically, rollbackNotificationRead } from '@/features/notifications/cache';

import type { NotificationRead } from '@/generated/api';
import type { NotificationListResponse } from '@/features/notifications/cache';
import {
  markAllNotificationsReadInList,
  markNotificationReadInList,
} from '@/features/notifications/cache';

const baseNotification: NotificationRead = {
  notification_id: 'notification-1',
  kind: 'score_invite.accepted',
  invite_id: 'invite-1',
  score_display_title: 'Etudes',
  score_id: 'score-1',
  actor: {
    display_name: 'Member',
    email: 'member@example.test',
    avatar_url: null,
  },
  read_at: null,
  created_at: '2026-07-01T00:00:00Z',
};

function response(data: NotificationRead[]): NotificationListResponse {
  return { pages: data.map((item, index) => ({items: [item], next_cursor: index < data.length - 1 ? 'next' : null })), pageParams: data.map((_, index) => index ? 'next' : undefined) };
}

describe('notification query optimistic helpers', () => {
  it('marks only the selected unread notification as read', () => {
    const current = response([
      baseNotification,
      {
        ...baseNotification,
        notification_id: 'notification-2',
        read_at: null,
      },
    ]);

    const next = markNotificationReadInList(current, 'notification-2', '2026-07-01T01:00:00Z');

    expect(next?.pages[0].items[0].read_at).toBeNull();
    expect(next?.pages[1].items[0].read_at).toBe('2026-07-01T01:00:00Z');
  });

  it('marks every unread notification as read without overwriting existing read timestamps', () => {
    const current = response([
      baseNotification,
      {
        ...baseNotification,
        notification_id: 'notification-2',
        read_at: '2026-07-01T00:30:00Z',
      },
    ]);

    const next = markAllNotificationsReadInList(current, '2026-07-01T01:00:00Z');

    expect(next?.pages[0].items[0].read_at).toBe('2026-07-01T01:00:00Z');
    expect(next?.pages[1].items[0].read_at).toBe('2026-07-01T00:30:00Z');
  });
});

it('decrements only an originally unread notification and restores its exact snapshot', async () => {
  const client = new QueryClient();
  const list = response([baseNotification]);
  client.setQueryData(notificationQueryKeys.list(), list);
  client.setQueryData(notificationQueryKeys.unreadCount(), { count: 2 });
  const snapshot = await notificationReadOptimistically(client, baseNotification.notification_id);
  const read = client.getQueryData<NotificationListResponse>(notificationQueryKeys.list())!.pages[0].items[0].read_at;
  expect(read).not.toBeNull();
  expect(client.getQueryData(notificationQueryKeys.unreadCount())).toEqual({ count: 1 });
  await notificationReadOptimistically(client, baseNotification.notification_id);
  await notificationReadOptimistically(client, 'absent');
  expect(client.getQueryData(notificationQueryKeys.unreadCount())).toEqual({ count: 1 });
  expect(client.getQueryData<NotificationListResponse>(notificationQueryKeys.list())!.pages[0].items[0].read_at).toBe(read);
  rollbackNotificationRead(client, snapshot);
  expect(client.getQueryData(notificationQueryKeys.list())).toEqual(list);
  expect(client.getQueryData(notificationQueryKeys.unreadCount())).toEqual({ count: 2 });
  client.clear();
});

it('bounds optimistic unread counts at zero and preserves existing read timestamps for mark-all', async () => {
  const client = new QueryClient();
  const readAt = '2026-07-01T00:30:00Z';
  const list = response([baseNotification, { ...baseNotification, notification_id: 'read', read_at: readAt }]);
  client.setQueryData(notificationQueryKeys.list(), list);
  client.setQueryData(notificationQueryKeys.unreadCount(), { count: 0 });
  await notificationReadOptimistically(client, baseNotification.notification_id);
  expect(client.getQueryData(notificationQueryKeys.unreadCount())).toEqual({ count: 0 });
  client.setQueryData(notificationQueryKeys.list(), list);
  const snapshot = await allNotificationsReadOptimistically(client);
  const optimistic = client.getQueryData<NotificationListResponse>(notificationQueryKeys.list())!;
  expect(optimistic.pages[0].items[0].read_at).not.toBeNull(); expect(optimistic.pages[1].items[0].read_at).toBe(readAt);
  rollbackNotificationRead(client, snapshot);
  expect(client.getQueryData(notificationQueryKeys.list())).toEqual(list);
  expect(client.getQueryData(notificationQueryKeys.unreadCount())).toEqual({ count: 0 });
  client.clear();
});
