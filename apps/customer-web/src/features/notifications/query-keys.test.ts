import { expect, it } from 'vitest';
import { notificationQueryKeys } from './query-keys';
import { collaborationQueryKeys } from '@/features/scores/collaboration/query-keys';
it('identifies durable Notification history separately from pending Collaboration actions', () => {
  expect(notificationQueryKeys.all).toEqual(['notifications']);
  expect(notificationQueryKeys.list()).toEqual(['notifications', 'list']);
  expect(notificationQueryKeys.unreadCount()).toEqual(['notifications', 'unread-count']);
  expect(collaborationQueryKeys.myInvites()).toEqual(['score-collaboration', 'pending']);
});
