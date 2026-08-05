import type { NotificationEvent } from '@/types/api';

export type NotificationDateGroupKey = 'today' | 'yesterday' | 'earlier';

export interface NotificationDateGroup {
  key: NotificationDateGroupKey;
  items: NotificationEvent[];
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function getNotificationDateGroupKey(
  createdAt: string,
  now: Date = new Date()
): NotificationDateGroupKey {
  const createdDate = new Date(createdAt);
  if (Number.isNaN(createdDate.getTime())) {
    return 'earlier';
  }

  const createdDay = startOfLocalDay(createdDate).getTime();
  const currentDay = startOfLocalDay(now).getTime();
  const dayDiff = Math.round((currentDay - createdDay) / 86_400_000);

  if (dayDiff <= 0) {
    return 'today';
  }
  if (dayDiff === 1) {
    return 'yesterday';
  }
  return 'earlier';
}

export function groupNotificationsByDate(
  notifications: NotificationEvent[],
  now: Date = new Date()
): NotificationDateGroup[] {
  const groups: Record<NotificationDateGroupKey, NotificationEvent[]> = {
    today: [],
    yesterday: [],
    earlier: [],
  };

  for (const notification of notifications) {
    groups[getNotificationDateGroupKey(notification.created_at, now)].push(notification);
  }

  return (['today', 'yesterday', 'earlier'] as const)
    .map((key) => ({ key, items: groups[key] }))
    .filter((group) => group.items.length > 0);
}
