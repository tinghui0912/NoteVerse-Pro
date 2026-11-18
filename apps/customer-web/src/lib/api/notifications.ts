import { notificationMarkRead, notificationsList, notificationsMarkAllRead, notificationsUnreadCountGet } from '@/generated/api';
import type { NotificationsListData } from '@/generated/api';
import { customerTransport, responseBody } from '@/lib/http/customer-browser-transport';


export const notificationsApi = {
  list: (params?: NotificationsListData['query'], signal?: AbortSignal) =>
    responseBody(notificationsList({ ...customerTransport.authenticated, query: params, signal })),
  unreadCount: (signal?: AbortSignal) =>
    responseBody(notificationsUnreadCountGet({ ...customerTransport.authenticated, signal })),
  markRead: (notificationId: string) =>
    responseBody(notificationMarkRead({ ...customerTransport.authenticated, path: { notification_id: notificationId } })),
  markAllRead: () =>
    responseBody(notificationsMarkAllRead({ ...customerTransport.authenticated })),
};
