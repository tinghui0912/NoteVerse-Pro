import { scoreLocation } from '@/features/scores/routes';
import { importActivityLocation, importReviewLocation } from '@/features/imports/routes';
import type { NotificationRead } from '@/generated/api';

export function notificationHref(notification: NotificationRead): string {
  switch (notification.kind) {
    case 'import.failed':
      return importActivityLocation();
    case 'import.ready_for_review':
      return notification.score_id
        ? scoreLocation(notification.score_id)
        : importReviewLocation(notification.job_id);
    case 'score_invite.accepted':
    case 'score_invite.declined':
    case 'score.version.created':
      return scoreLocation(notification.score_id);
    default: {
      const exhaustive: never = notification;
      return exhaustive;
    }
  }
}
