import { notificationQueryKeys } from '@/features/notifications/query-keys';
import type { QueryClient, InfiniteData } from '@tanstack/react-query';
import type { NotificationsListResponse, NotificationsUnreadCountGetResponse } from '@/generated/api';

export type NotificationListResponse = InfiniteData<NotificationsListResponse, string | undefined>;
type NotificationCountResponse = NotificationsUnreadCountGetResponse;

export interface NotificationOptimisticSnapshot {
  previousList?: NotificationListResponse;
  previousCount?: NotificationCountResponse;
}

function readTimestamp() {
  return new Date().toISOString();
}

export function markNotificationReadInList(
  response: NotificationListResponse | undefined,
  notificationId: string,
  readAt = readTimestamp()
): NotificationListResponse | undefined {
  if (!response) return response;
  return { ...response, pages: response.pages.map(page => ({ ...page, items: page.items.map((notification) =>
      notification.notification_id === notificationId && !notification.read_at
        ? { ...notification, read_at: readAt }
        : notification
    ) })) };
}

export function markAllNotificationsReadInList(
  response: NotificationListResponse | undefined,
  readAt = readTimestamp()
): NotificationListResponse | undefined {
  if (!response) return response;
  return { ...response, pages: response.pages.map(page => ({ ...page, items: page.items.map((notification) =>
      notification.read_at ? notification : { ...notification, read_at: readAt }
    ) })) };
}

function decrementUnreadCount(
  response: NotificationCountResponse | undefined
): NotificationCountResponse | undefined {
  if (!response) return response;
  return {
    ...response,
    count: Math.max(0, response.count - 1),
  };
}

function clearUnreadCount(
  response: NotificationCountResponse | undefined
): NotificationCountResponse | undefined {
  if (!response) return response;
  return {
    ...response,
    count: 0,
  };
}


export async function notificationsChanged(client: QueryClient) {
  await Promise.all([
    client.invalidateQueries({ queryKey: notificationQueryKeys.list() }),
    client.invalidateQueries({ queryKey: notificationQueryKeys.unreadCount() }),
  ]);
}

async function snapshotNotifications(client: QueryClient): Promise<NotificationOptimisticSnapshot> {
  await Promise.all([
    client.cancelQueries({ queryKey: notificationQueryKeys.list() }),
    client.cancelQueries({ queryKey: notificationQueryKeys.unreadCount() }),
  ]);
  return {
    previousList: client.getQueryData<NotificationListResponse>(notificationQueryKeys.list()),
    previousCount: client.getQueryData<NotificationCountResponse>(notificationQueryKeys.unreadCount()),
  };
}

export async function notificationReadOptimistically(client: QueryClient, notificationId: string) {
  const snapshot = await snapshotNotifications(client);
  const wasUnread = snapshot.previousList?.pages.some(page => page.items.some((item) => item.notification_id === notificationId && !item.read_at));
  client.setQueryData<NotificationListResponse>(notificationQueryKeys.list(), (current) => markNotificationReadInList(current, notificationId));
  if (wasUnread) client.setQueryData<NotificationCountResponse>(notificationQueryKeys.unreadCount(), decrementUnreadCount);
  return snapshot;
}

export async function allNotificationsReadOptimistically(client: QueryClient) {
  const snapshot = await snapshotNotifications(client);
  client.setQueryData<NotificationListResponse>(notificationQueryKeys.list(), markAllNotificationsReadInList);
  client.setQueryData<NotificationCountResponse>(notificationQueryKeys.unreadCount(), clearUnreadCount);
  return snapshot;
}

export function rollbackNotificationRead(client: QueryClient, snapshot?: NotificationOptimisticSnapshot) {
  if (snapshot?.previousList !== undefined) client.setQueryData(notificationQueryKeys.list(), snapshot.previousList);
  if (snapshot?.previousCount !== undefined) client.setQueryData(notificationQueryKeys.unreadCount(), snapshot.previousCount);
}
