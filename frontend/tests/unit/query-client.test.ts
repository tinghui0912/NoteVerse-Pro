import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { queryKeys } from '@/lib/query-client';

describe('queryKeys', () => {
  it('builds hierarchical score keys', () => {
    expect(queryKeys.scores.all).toEqual(['scores']);
    expect(queryKeys.scores.lists()).toEqual(['scores', 'list']);
    expect(queryKeys.scores.list(2, 20, 'bach')).toEqual([
      'scores',
      'list',
      { page: 2, pageSize: 20, search: 'bach' },
    ]);
    expect(queryKeys.scores.details()).toEqual(['scores', 'detail']);
    expect(queryKeys.scores.detail('score-1')).toEqual([
      'scores',
      'detail',
      { scoreId: 'score-1' },
    ]);
  });

  it('keeps revision, artifact, grant, and publication identities in score keys', () => {
    expect(queryKeys.scores.revisions('score-1')).toEqual([
      'scores',
      'revision',
      { scoreId: 'score-1' },
    ]);
    expect(queryKeys.scores.revision('score-1', 'revision-1')).toEqual([
      'scores',
      'revision',
      { scoreId: 'score-1', revisionId: 'revision-1' },
    ]);
    expect(queryKeys.scores.artifacts('score-1', 'revision-1', 'MUSICXML')).toEqual([
      'scores',
      'artifact',
      { scoreId: 'score-1', revisionId: 'revision-1', kind: 'MUSICXML' },
    ]);
    expect(queryKeys.scores.grants('score-1')).toEqual([
      'scores',
      'grant',
      { scoreId: 'score-1' },
    ]);
    expect(queryKeys.scores.grantAccess('token-1')).toEqual([
      'scores',
      'grant-access',
      { token: 'token-1' },
    ]);
    expect(queryKeys.scores.invites('score-1')).toEqual([
      'scores',
      'invite',
      { scoreId: 'score-1' },
    ]);
    expect(queryKeys.scores.inviteAccess('invite-token-1')).toEqual([
      'scores',
      'invite-access',
      { token: 'invite-token-1' },
    ]);
    expect(queryKeys.scores.members('score-1')).toEqual([
      'scores',
      'member',
      { scoreId: 'score-1' },
    ]);
    expect(queryKeys.scores.publication('slug-1')).toEqual([
      'scores',
      'publication',
      { slug: 'slug-1' },
    ]);
    expect(queryKeys.notifications.list()).toEqual(['notifications', 'list']);
    expect(queryKeys.notifications.unreadCount()).toEqual([
      'notifications',
      'unread-count',
    ]);
  });

  it('invalidates every revision variant for one score through the revision prefix', async () => {
    const client = new QueryClient();
    const firstKey = queryKeys.scores.revision('score-1', 'revision-1');
    const secondKey = queryKeys.scores.revision('score-1', 'revision-2');
    const otherScoreKey = queryKeys.scores.revision('score-2', 'revision-1');

    client.setQueryData(firstKey, '<score />');
    client.setQueryData(secondKey, '<score />');
    client.setQueryData(otherScoreKey, '<score />');

    await client.invalidateQueries({ queryKey: queryKeys.scores.revisions('score-1') });

    expect(client.getQueryState(firstKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(secondKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherScoreKey)?.isInvalidated).toBe(false);
  });

  it('keeps score details distinct under one score detail prefix', async () => {
    const client = new QueryClient();
    const firstScoreKey = queryKeys.scores.detail('score-1');
    const secondScoreKey = queryKeys.scores.detail('score-2');

    client.setQueryData(firstScoreKey, { title: 'A' });
    client.setQueryData(secondScoreKey, { title: 'B' });

    await client.invalidateQueries({ queryKey: queryKeys.scores.detail('score-1') });

    expect(client.getQueryState(firstScoreKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(secondScoreKey)?.isInvalidated).toBe(false);
  });
});
