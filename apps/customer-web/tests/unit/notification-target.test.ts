import { describe, expect, it } from 'vitest';

import { notificationHref } from '@/lib/notifications/target';
import type { NotificationEvent } from '@/types/api';

const baseNotification: NotificationEvent = {
  notification_id: 'notification-1',
  type: 'score_invite.accepted',
  title: 'Notification',
  body: null,
  score_id: null,
  actor: null,
  data: {},
  read_at: null,
  created_at: '2026-07-01T00:00:00Z',
};

describe('notification target resolution', () => {
  it('opens failed imports in the upload job view', () => {
    expect(
      notificationHref({
        ...baseNotification,
        type: 'import.failed',
        data: { job_id: 'failed job' },
      })
    ).toBe('/upload?job_id=failed%20job');
  });

  it('opens completed imports with only a job id in review', () => {
    expect(
      notificationHref({
        ...baseNotification,
        type: 'import.completed',
        data: { job_id: 'ready-job-1' },
      })
    ).toBe('/review/ready-job-1');
  });

  it('opens completed imports with a score id in the score detail page', () => {
    expect(
      notificationHref({
        ...baseNotification,
        type: 'import.completed',
        score_id: null,
        data: { job_id: 'ready-job-1', score_id: 'score-1' },
      })
    ).toBe('/score/score-1');
  });

  it('falls back to score_id for score notifications', () => {
    expect(notificationHref({ ...baseNotification, score_id: 'score-2' })).toBe(
      '/score/score-2'
    );
  });

  it('returns null when a notification has no product target', () => {
    expect(notificationHref(baseNotification)).toBeNull();
  });
});
