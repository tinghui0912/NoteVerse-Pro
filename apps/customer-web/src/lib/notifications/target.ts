import { importActivityLocation, importReviewLocation, importConfirmedScoreLocation } from '@/features/imports/routes';
import type { NotificationRead } from '@/generated/api';

export function notificationHref(notification: NotificationRead): string {
  switch (notification.kind) {
    case 'import.failed':
      return importActivityLocation();
    case 'import.ready_for_review':
      return notification.score_id
        ? importConfirmedScoreLocation(notification.score_id)
        : importReviewLocation(notification.job_id);
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
