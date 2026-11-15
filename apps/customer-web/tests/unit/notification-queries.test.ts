import { describe, expect, it } from 'vitest';

import type { NotificationRead, NotificationsListResponse } from '@/generated/api';
import {
  markAllNotificationsReadInList,
  markNotificationReadInList,
} from '@/hooks/queries/use-notification-queries';

const baseNotification: NotificationRead = {
  notification_id: 'notification-1',
  kind: 'score_invite.accepted',
  invite_id: 'invite-1',
  score_display_title: 'Etudes',
  score_id: 'score-1',
  actor: {
    display_name: 'Member',
    email: 'member@example.test',
    avatar_url: null,
  },
  read_at: null,
  created_at: '2026-07-01T00:00:00Z',
};

function response(data: NotificationRead[]): NotificationsListResponse {
  return data;
}

describe('notification query optimistic helpers', () => {
  it('marks only the selected unread notification as read', () => {
    const current = response([
      baseNotification,
      {
        ...baseNotification,
        notification_id: 'notification-2',
        read_at: null,
      },
    ]);

    const next = markNotificationReadInList(current, 'notification-1', '2026-07-01T01:00:00Z');

    expect(next?.[0].read_at).toBe('2026-07-01T01:00:00Z');
    expect(next?.[1].read_at).toBeNull();
  });

  it('marks every unread notification as read without overwriting existing read timestamps', () => {
    const current = response([
      baseNotification,
      {
        ...baseNotification,
        notification_id: 'notification-2',
        read_at: '2026-07-01T00:30:00Z',
      },
    ]);

    const next = markAllNotificationsReadInList(current, '2026-07-01T01:00:00Z');

    expect(next?.[0].read_at).toBe('2026-07-01T01:00:00Z');
    expect(next?.[1].read_at).toBe('2026-07-01T00:30:00Z');
  });
});
