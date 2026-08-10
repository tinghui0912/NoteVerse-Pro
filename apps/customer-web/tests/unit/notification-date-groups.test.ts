import { describe, expect, it } from 'vitest';

import {
  getNotificationDateGroupKey,
  groupNotificationsByDate,
} from '@/lib/notifications/date-groups';
import type { NotificationEventRead } from '@/generated/api';

const baseNotification: NotificationEventRead = {
  notification_id: 'notification-1',
  type: 'score_invite.accepted',
  title: 'Invite accepted',
  body: null,
  score_id: 'score-1',
  actor: null,
  data: {},
  read_at: null,
  created_at: '2026-07-02T08:00:00Z',
};

describe('notification date groups', () => {
  it('classifies notifications into today, yesterday, and earlier', () => {
    const now = new Date('2026-07-02T12:00:00Z');

    expect(getNotificationDateGroupKey('2026-07-02T08:00:00Z', now)).toBe('today');
    expect(getNotificationDateGroupKey('2026-07-01T08:00:00Z', now)).toBe('yesterday');
    expect(getNotificationDateGroupKey('2026-06-30T08:00:00Z', now)).toBe('earlier');
  });

  it('keeps group order stable while preserving item order inside each group', () => {
    const now = new Date('2026-07-02T12:00:00Z');
    const groups = groupNotificationsByDate(
      [
        {
          ...baseNotification,
          notification_id: 'today-1',
          created_at: '2026-07-02T08:00:00Z',
        },
        {
          ...baseNotification,
          notification_id: 'earlier-1',
          created_at: '2026-06-30T08:00:00Z',
        },
        {
          ...baseNotification,
          notification_id: 'yesterday-1',
          created_at: '2026-07-01T08:00:00Z',
        },
        {
          ...baseNotification,
          notification_id: 'today-2',
          created_at: '2026-07-02T07:00:00Z',
        },
      ],
      now
    );

    expect(groups.map((group) => group.key)).toEqual(['today', 'yesterday', 'earlier']);
    expect(groups[0].items.map((item) => item.notification_id)).toEqual([
      'today-1',
      'today-2',
    ]);
  });
});
