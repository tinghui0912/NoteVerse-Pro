import { expect, it } from 'vitest';
import { scoreQueryKeys } from './core/query-keys';
import { collaborationQueryKeys } from './collaboration/query-keys';
import { guestPreviewQueryKeys } from './guest-preview/query-keys';
it('identifies Score resources, Collaboration actions and Guest Preview projections independently', () => {
  expect([scoreQueryKeys.all, collaborationQueryKeys.all, guestPreviewQueryKeys.all]).toEqual([['scores'], ['score-collaboration'], ['guest-preview']]);
  expect(collaborationQueryKeys.myInvites()).toEqual(['score-collaboration', 'pending']);
  expect(guestPreviewQueryKeys.settings('score')).toEqual(['guest-preview', 'settings', {scoreId: 'score'}]);
  expect(guestPreviewQueryKeys.public('token')).toEqual(['guest-preview', 'public', {token: 'token'}]);
});
