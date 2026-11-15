import type { NotificationRead } from '@/generated/api';

export function notificationHref(notification: NotificationRead): string {
  switch (notification.kind) {
    case 'import.failed':
      return '/upload#import-activity';
    case 'import.completed':
      return notification.score_id
        ? `/score/${encodeURIComponent(notification.score_id)}`
        : `/review/${encodeURIComponent(notification.job_id)}`;
    case 'score_invite.accepted':
    case 'score_invite.declined':
    case 'score.version.created':
      return `/score/${encodeURIComponent(notification.score_id)}`;
    default: {
      const exhaustive: never = notification;
      return exhaustive;
    }
  }
}
