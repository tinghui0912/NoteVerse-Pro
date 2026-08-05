import { apiClient, type ApiResponse } from '@/lib/api-client';
import type { NotificationEvent, NotificationUnreadCount } from '@/types/api';

export const notificationsApi = {
  list: (signal?: AbortSignal) =>
    apiClient.get<ApiResponse<NotificationEvent[]>>('/me/notifications', undefined, {
      signal,
    }),
  unreadCount: (signal?: AbortSignal) =>
    apiClient.get<ApiResponse<NotificationUnreadCount>>(
      '/me/notifications/unread-count',
      undefined,
      { signal }
    ),
  markRead: (notificationId: string) =>
    apiClient.post<ApiResponse<NotificationEvent>>(
      `/me/notifications/${notificationId}/read`
    ),
  markAllRead: () =>
    apiClient.post<ApiResponse<NotificationUnreadCount>>('/me/notifications/read-all'),
};
