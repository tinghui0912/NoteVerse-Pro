import { apiClient, type ApiResponse } from '@/lib/api-client';
import type { NotificationEventRead, NotificationUnreadCountRead } from '@/generated/api';

export const notificationsApi = {
  list: (signal?: AbortSignal) =>
    apiClient.get<ApiResponse<NotificationEventRead[]>>('/me/notifications', undefined, {
      signal,
    }),
  unreadCount: (signal?: AbortSignal) =>
    apiClient.get<ApiResponse<NotificationUnreadCountRead>>(
      '/me/notifications/unread-count',
      undefined,
      { signal }
    ),
  markRead: (notificationId: string) =>
    apiClient.post<ApiResponse<NotificationEventRead>>(
      `/me/notifications/${notificationId}/read`
    ),
  markAllRead: () =>
    apiClient.post<ApiResponse<NotificationUnreadCountRead>>('/me/notifications/read-all'),
};
