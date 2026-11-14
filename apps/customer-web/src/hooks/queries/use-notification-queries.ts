'use client';

import type { NotificationsListResponse, NotificationsUnreadCountGetResponse } from '@/generated/api';
import { notificationsApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

type NotificationListResponse = NotificationsListResponse;
type NotificationCountResponse = NotificationsUnreadCountGetResponse;

interface NotificationOptimisticSnapshot {
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

export function useMyNotifications(enabled = true) {
  return useQuery({
    queryKey: queryKeys.notifications.list(),
    queryFn: ({ signal }) => notificationsApi.list(signal),
    enabled,
  });
}

export function useNotificationUnreadCount(enabled = true) {
  return useQuery({
    queryKey: queryKeys.notifications.unreadCount(),
    queryFn: ({ signal }) => notificationsApi.unreadCount(signal),
    enabled,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) => notificationsApi.markRead(notificationId),
    onMutate: async (notificationId): Promise<NotificationOptimisticSnapshot> => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: queryKeys.notifications.list() }),
        queryClient.cancelQueries({ queryKey: queryKeys.notifications.unreadCount() }),
      ]);

      const previousList = queryClient.getQueryData<NotificationListResponse>(
        queryKeys.notifications.list()
      );
      const previousCount = queryClient.getQueryData<NotificationCountResponse>(
        queryKeys.notifications.unreadCount()
      );
      const wasUnread = previousList?.some(
        (notification) =>
          notification.notification_id === notificationId && !notification.read_at
      );

      queryClient.setQueryData<NotificationListResponse>(
        queryKeys.notifications.list(),
        (current) => markNotificationReadInList(current, notificationId)
      );
      if (wasUnread) {
        queryClient.setQueryData<NotificationCountResponse>(
          queryKeys.notifications.unreadCount(),
          decrementUnreadCount
        );
      }

      return { previousList, previousCount };
    },
    onError: (_error, _notificationId, snapshot) => {
      if (snapshot?.previousList) {
        queryClient.setQueryData(queryKeys.notifications.list(), snapshot.previousList);
      }
      if (snapshot?.previousCount) {
        queryClient.setQueryData(
          queryKeys.notifications.unreadCount(),
          snapshot.previousCount
        );
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.unreadCount() });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onMutate: async (): Promise<NotificationOptimisticSnapshot> => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: queryKeys.notifications.list() }),
        queryClient.cancelQueries({ queryKey: queryKeys.notifications.unreadCount() }),
      ]);

      const previousList = queryClient.getQueryData<NotificationListResponse>(
        queryKeys.notifications.list()
      );
      const previousCount = queryClient.getQueryData<NotificationCountResponse>(
        queryKeys.notifications.unreadCount()
      );

      queryClient.setQueryData<NotificationListResponse>(
        queryKeys.notifications.list(),
        markAllNotificationsReadInList
      );
      queryClient.setQueryData<NotificationCountResponse>(
        queryKeys.notifications.unreadCount(),
        clearUnreadCount
      );

      return { previousList, previousCount };
    },
    onError: (_error, _variables, snapshot) => {
      if (snapshot?.previousList) {
        queryClient.setQueryData(queryKeys.notifications.list(), snapshot.previousList);
      }
      if (snapshot?.previousCount) {
        queryClient.setQueryData(
          queryKeys.notifications.unreadCount(),
          snapshot.previousCount
        );
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.unreadCount() });
    },
  });
}
