import { guestPreviewQueryKeys } from '@/features/scores/guest-preview/query-keys';
import { scoreQueryKeys } from '@/features/scores/core/query-keys';
import { collaborationQueryKeys } from '@/features/scores/collaboration/query-keys';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { queryKeys } from '@/lib/query-client';

describe('queryKeys', () => {
  it('builds hierarchical score detail keys', () => {
    expect(scoreQueryKeys.all).toEqual(['scores']);
    expect(scoreQueryKeys.details()).toEqual(['scores', 'detail']);
    expect(scoreQueryKeys.detail('score-1')).toEqual([
      'scores',
      'detail',
      { scoreId: 'score-1' },
    ]);
  });

  it('keeps core, Collaboration and Guest Preview query identities distinct', () => {
    expect(scoreQueryKeys.revisions('score-1')).toEqual([
      'scores',
      'revision',
      { scoreId: 'score-1' },
    ]);
    expect(scoreQueryKeys.revision('score-1', 'revision-1')).toEqual([
      'scores',
      'revision',
      { scoreId: 'score-1', revisionId: 'revision-1' },
    ]);
    expect(scoreQueryKeys.revisionAssets('score-1', 'revision-1')).toEqual([
      'scores',
      'revision-assets',
      { scoreId: 'score-1', revisionId: 'revision-1' },
    ]);
    expect(guestPreviewQueryKeys.settings('score-1')).toEqual([
      'guest-preview',
      'settings',
      { scoreId: 'score-1' },
    ]);
    expect(guestPreviewQueryKeys.public('token-1')).toEqual([
      'guest-preview',
      'public',
      { token: 'token-1' },
    ]);
    expect(collaborationQueryKeys.invites('score-1')).toEqual([
      'score-collaboration',
      'invite',
      { scoreId: 'score-1' },
    ]);
    expect(collaborationQueryKeys.inviteAccess('invite-token-1')).toEqual([
      'score-collaboration',
      'inspection',
      { token: 'invite-token-1' },
    ]);
    expect(collaborationQueryKeys.members('score-1')).toEqual([
      'score-collaboration',
      'member',
      { scoreId: 'score-1' },
    ]);
    expect(queryKeys.notifications.list()).toEqual(['notifications', 'list']);
    expect(queryKeys.notifications.unreadCount()).toEqual(['notifications', 'unread-count']);
  });

  it('invalidates every revision variant for one score through the revision prefix', async () => {
    const client = new QueryClient();
    const firstKey = scoreQueryKeys.revision('score-1', 'revision-1');
    const secondKey = scoreQueryKeys.revision('score-1', 'revision-2');
    const otherScoreKey = scoreQueryKeys.revision('score-2', 'revision-1');

    client.setQueryData(firstKey, '<score />');
    client.setQueryData(secondKey, '<score />');
    client.setQueryData(otherScoreKey, '<score />');

    await client.invalidateQueries({ queryKey: scoreQueryKeys.revisions('score-1') });

    expect(client.getQueryState(firstKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(secondKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherScoreKey)?.isInvalidated).toBe(false);
  });

  it('keeps score details distinct under one score detail prefix', async () => {
    const client = new QueryClient();
    const firstScoreKey = scoreQueryKeys.detail('score-1');
    const secondScoreKey = scoreQueryKeys.detail('score-2');

    client.setQueryData(firstScoreKey, { title: 'A' });
    client.setQueryData(secondScoreKey, { title: 'B' });

    await client.invalidateQueries({ queryKey: scoreQueryKeys.detail('score-1') });

    expect(client.getQueryState(firstScoreKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(secondScoreKey)?.isInvalidated).toBe(false);
  });
});
