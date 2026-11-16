'use client';

import { notificationsApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationReadOptimistically, allNotificationsReadOptimistically, rollbackNotificationRead, notificationsChanged } from '@/lib/cache-effects/notifications';

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
  const client = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) => notificationsApi.markRead(notificationId),
    onMutate: (notificationId) => notificationReadOptimistically(client, notificationId),
    onError: (_error, _notificationId, snapshot) => rollbackNotificationRead(client, snapshot),
    onSettled: () => notificationsChanged(client),
  });
}

export function useMarkAllNotificationsRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onMutate: () => allNotificationsReadOptimistically(client),
    onError: (_error, _variables, snapshot) => rollbackNotificationRead(client, snapshot),
    onSettled: () => notificationsChanged(client),
  });
}
