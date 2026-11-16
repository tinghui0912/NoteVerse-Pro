import { describe, expect, it } from 'vitest';
import type { NotificationRead } from '@/generated/api';
import { notificationHref } from '@/lib/notifications/target';
import { notificationPresentation } from '@/lib/notifications/presentation';
import en from '../../messages/en/notifications.json';
import zh from '../../messages/zh/notifications.json';

const common = {
  notification_id: 'notice',
  read_at: null,
  created_at: '2026-07-01T00:00:00Z',
};
const actor = {
  display_name: 'Member',
  email: 'member@example.test',
  avatar_url: null,
};
const variants: NotificationRead[] = [
  {
    ...common,
    kind: 'score_invite.accepted',
    actor,
    invite_id: 'invite',
    score_id: 'score',
    score_display_title: 'Etudes',
  },
  {
    ...common,
    kind: 'score_invite.declined',
    actor,
    invite_id: 'invite',
    score_id: 'score',
    score_display_title: 'Etudes',
  },
  {
    ...common,
    kind: 'score.version.created',
    actor,
    score_id: 'score',
    revision_id: 'revision',
    score_display_title: 'Etudes',
  },
  {
    ...common,
    kind: 'import.ready_for_review',
    job_id: 'job',
    import_display_title: 'Etudes',
    score_id: null,
    score_display_title: null,
  },
  { ...common, kind: 'import.failed', job_id: 'job', import_display_title: null },
];

describe('typed notification presentation and navigation', () => {
  it.each(variants)('localizes $kind from semantic fields', (notification) => {
    for (const messages of [en, zh]) {
      const translate = (key: Exclude<keyof typeof en, 'dateGroups'>, values?: { name: string }) =>
        messages[key].replace('{name}', values?.name ?? '');
      const presentation = notificationPresentation(notification, translate);
      expect(presentation.title).toBeTruthy();
      expect(presentation.subtitle).toBe(
        notification.kind === 'import.failed' ? messages.processingFailedSubtitle : 'Etudes'
      );
    }
  });
  it.each(variants.slice(0, 3))('opens score for $kind', (notification) => {
    expect(notificationHref(notification)).toBe('/score/score');
  });
  it('opens review before confirmation and score after confirmation', () => {
    expect(notificationHref(variants[3])).toBe('/review/job');
    expect(
      notificationHref({
        ...common,
        kind: 'import.ready_for_review',
        job_id: 'job',
        import_display_title: null,
        score_id: 'score',
        score_display_title: 'Etudes',
      })
    ).toBe('/score/score');
    expect(notificationHref(variants[4])).toBe('/upload#import-activity');
  });
});
