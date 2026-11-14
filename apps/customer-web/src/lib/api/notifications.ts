import { notificationMarkRead, notificationsList, notificationsMarkAllRead, notificationsUnreadCountGet } from '@/generated/api';
import { customerTransport, responseBody } from '@/lib/http/customer-browser-transport';


export const notificationsApi = {
  list: (signal?: AbortSignal) =>
    responseBody(notificationsList({ ...customerTransport.authenticated, signal })),
  unreadCount: (signal?: AbortSignal) =>
    responseBody(notificationsUnreadCountGet({ ...customerTransport.authenticated, signal })),
  markRead: (notificationId: string) =>
    responseBody(notificationMarkRead({ ...customerTransport.authenticated, path: { notification_id: notificationId } })),
  markAllRead: () =>
    responseBody(notificationsMarkAllRead({ ...customerTransport.authenticated })),
};
