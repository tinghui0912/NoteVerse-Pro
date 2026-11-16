import type { QueryClient } from '@tanstack/react-query';
import type { NotificationsListResponse, NotificationsUnreadCountGetResponse } from '@/generated/api';
import { queryKeys } from '@/lib/query-client';

type NotificationListResponse = NotificationsListResponse;
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
  return response.map((notification) =>
      notification.notification_id === notificationId && !notification.read_at
        ? { ...notification, read_at: readAt }
        : notification
    );
}

export function markAllNotificationsReadInList(
  response: NotificationListResponse | undefined,
  readAt = readTimestamp()
): NotificationListResponse | undefined {
  if (!response) return response;
  return response.map((notification) =>
      notification.read_at ? notification : { ...notification, read_at: readAt }
    );
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
    client.invalidateQueries({ queryKey: queryKeys.notifications.list() }),
    client.invalidateQueries({ queryKey: queryKeys.notifications.unreadCount() }),
  ]);
}

async function snapshotNotifications(client: QueryClient): Promise<NotificationOptimisticSnapshot> {
  await Promise.all([
    client.cancelQueries({ queryKey: queryKeys.notifications.list() }),
    client.cancelQueries({ queryKey: queryKeys.notifications.unreadCount() }),
  ]);
  return {
    previousList: client.getQueryData<NotificationListResponse>(queryKeys.notifications.list()),
    previousCount: client.getQueryData<NotificationCountResponse>(queryKeys.notifications.unreadCount()),
  };
}

export async function notificationReadOptimistically(client: QueryClient, notificationId: string) {
  const snapshot = await snapshotNotifications(client);
  const wasUnread = snapshot.previousList?.some((item) => item.notification_id === notificationId && !item.read_at);
  client.setQueryData<NotificationListResponse>(queryKeys.notifications.list(), (current) => markNotificationReadInList(current, notificationId));
  if (wasUnread) client.setQueryData<NotificationCountResponse>(queryKeys.notifications.unreadCount(), decrementUnreadCount);
  return snapshot;
}

export async function allNotificationsReadOptimistically(client: QueryClient) {
  const snapshot = await snapshotNotifications(client);
  client.setQueryData<NotificationListResponse>(queryKeys.notifications.list(), markAllNotificationsReadInList);
  client.setQueryData<NotificationCountResponse>(queryKeys.notifications.unreadCount(), clearUnreadCount);
  return snapshot;
}

export function rollbackNotificationRead(client: QueryClient, snapshot?: NotificationOptimisticSnapshot) {
  if (snapshot?.previousList !== undefined) client.setQueryData(queryKeys.notifications.list(), snapshot.previousList);
  if (snapshot?.previousCount !== undefined) client.setQueryData(queryKeys.notifications.unreadCount(), snapshot.previousCount);
}
