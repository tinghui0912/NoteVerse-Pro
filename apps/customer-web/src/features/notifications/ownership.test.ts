import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { queryKeys } from '@/lib/query-client';
import { notificationQueryKeys } from './query-keys';
import { collaborationQueryKeys } from '@/features/scores/collaboration/query-keys';

it('owns durable Notification identities independently from Collaboration actions', () => {
  expect(notificationQueryKeys.all).toEqual(['notifications']);
  expect(notificationQueryKeys.list()).toEqual(['notifications', 'list']);
  expect(notificationQueryKeys.unreadCount()).toEqual(['notifications', 'unread-count']);
  expect(queryKeys).not.toHaveProperty('notifications');
  expect(collaborationQueryKeys.all[0]).not.toBe(notificationQueryKeys.all[0]);
});

it('has a single feature owner for Notification application and presentation', () => {
  const root = resolve(process.cwd(), 'src');
  for (const file of ['api.ts', 'query-keys.ts', 'queries.ts', 'cache.ts', 'presentation.ts', 'target.ts', 'date-groups.ts', 'center/notification-center-dialog.tsx', 'center/notification-bell.tsx']) {
    expect(existsSync(resolve(root, 'features/notifications', file))).toBe(true);
  }
  for (const path of ['components/notifications', 'hooks/queries/use-notification-queries.ts', 'lib/api/notifications.ts', 'lib/cache-effects/notifications.ts', 'lib/notifications']) {
    expect(existsSync(resolve(root, path))).toBe(false);
  }
});
