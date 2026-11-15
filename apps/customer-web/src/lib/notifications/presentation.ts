import type { NotificationRead } from '@/generated/api';

type MessageKey =
  | 'acceptedInvite'
  | 'declinedInvite'
  | 'scoreVersionCreated'
  | 'processingCompleted'
  | 'processingFailed'
  | 'unknownActor'
  | 'scoreDisplayTitleFallback'
  | 'processingFailedSubtitle';
type Translate = (key: MessageKey, values?: { name: string }) => string;

export function notificationPresentation(notification: NotificationRead, t: Translate) {
  switch (notification.kind) {
    case 'score_invite.accepted':
      return {
        title: t('acceptedInvite', {
          name: notification.actor.display_name || notification.actor.email || t('unknownActor'),
        }),
        subtitle: notification.score_display_title,
      };
    case 'score_invite.declined':
      return {
        title: t('declinedInvite', {
          name: notification.actor.display_name || notification.actor.email || t('unknownActor'),
        }),
        subtitle: notification.score_display_title,
      };
    case 'score.version.created':
      return {
        title: t('scoreVersionCreated', {
          name: notification.actor.display_name || notification.actor.email || t('unknownActor'),
        }),
        subtitle: notification.score_display_title,
      };
    case 'import.completed':
      return {
        title: t('processingCompleted'),
        subtitle: notification.score_display_title || notification.import_display_title || t('scoreDisplayTitleFallback'),
      };
    case 'import.failed':
      return {
        title: t('processingFailed'),
        subtitle: notification.import_display_title || t('processingFailedSubtitle'),
      };
    default: {
      const exhaustive: never = notification;
      return exhaustive;
    }
  }
}
