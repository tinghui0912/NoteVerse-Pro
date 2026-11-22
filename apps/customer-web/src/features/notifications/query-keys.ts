const root = ['notifications'] as const;

export const notificationQueryKeys = {
  all: root,
  list: () => [...root, 'list'] as const,
  unreadCount: () => [...root, 'unread-count'] as const,
};
