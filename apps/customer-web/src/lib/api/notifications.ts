import { notificationMarkRead, notificationsList, notificationsMarkAllRead, notificationsUnreadCountGet } from '@/generated/api';
import { customerTransport, responseData } from '@/lib/http/customer-browser-transport';


export const notificationsApi = {
  list: (signal?: AbortSignal) =>
    responseData(notificationsList({ ...customerTransport.authenticated, signal })),
  unreadCount: (signal?: AbortSignal) =>
    responseData(notificationsUnreadCountGet({ ...customerTransport.authenticated, signal })),
  markRead: (notificationId: string) =>
    responseData(notificationMarkRead({ ...customerTransport.authenticated, path: { notification_id: notificationId } })),
  markAllRead: () =>
    responseData(notificationsMarkAllRead({ ...customerTransport.authenticated })),
};
