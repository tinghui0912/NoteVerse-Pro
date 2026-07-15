import { describe, expect, it } from 'vitest';

import {
  markAllNotificationsReadInList,
  markNotificationReadInList,
} from '@/hooks/queries/use-notification-queries';
import type { ApiResponse, NotificationEvent } from '@/types/api';

const baseNotification: NotificationEvent = {
  notification_id: 'notification-1',
  type: 'score_invite.accepted',
  title: 'Invite accepted',
  body: null,
  score_id: 'score-1',
  actor: null,
  data: {},
  read_at: null,
  created_at: '2026-07-01T00:00:00Z',
};

function response(data: NotificationEvent[]): ApiResponse<NotificationEvent[]> {
  return { success: true, data };
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

    const next = markNotificationReadInList(
      current,
      'notification-1',
      '2026-07-01T01:00:00Z'
    );

    expect(next?.data?.[0].read_at).toBe('2026-07-01T01:00:00Z');
    expect(next?.data?.[1].read_at).toBeNull();
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

    expect(next?.data?.[0].read_at).toBe('2026-07-01T01:00:00Z');
    expect(next?.data?.[1].read_at).toBe('2026-07-01T00:30:00Z');
  });
});
