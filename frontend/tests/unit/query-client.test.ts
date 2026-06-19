import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { queryKeys } from '@/lib/query-client';

describe('queryKeys', () => {
  it('builds hierarchical task keys', () => {
    const filters = {
      page: 2,
      pageSize: 20,
      state: 'SUCCESS',
      sortBy: 'created_at',
      sortOrder: 'desc',
      search: 'bach',
    };

    expect(queryKeys.tasks.all).toEqual(['tasks']);
    expect(queryKeys.tasks.lists()).toEqual(['tasks', 'list']);
    expect(queryKeys.tasks.list(filters)).toEqual(['tasks', 'list', filters]);
    expect(queryKeys.tasks.details()).toEqual(['tasks', 'detail']);
    expect(queryKeys.tasks.task('task-1')).toEqual([
      'tasks',
      'detail',
      { id: 'task-1' },
    ]);
    expect(queryKeys.tasks.detail('task-1', 'share-1')).toEqual([
      'tasks',
      'detail',
      { id: 'task-1', shareToken: 'share-1' },
    ]);
  });

  it('keeps share and XML identities in their keys', () => {
    expect(queryKeys.shares.list('task-1')).toEqual(['shares', 'list', 'task-1']);
    expect(queryKeys.shares.access('share-1')).toEqual(['shares', 'access', 'share-1']);
    expect(queryKeys.xml.content('task-1', 'final', 'token-1')).toEqual([
      'xml',
      'content',
      { taskId: 'task-1', source: 'final', shareToken: 'token-1' },
    ]);
    expect(queryKeys.xml.task('task-1')).toEqual([
      'xml',
      'content',
      { taskId: 'task-1' },
    ]);
    expect(queryKeys.xml.share('share-1')).toEqual([
      'xml',
      'share',
      { shareId: 'share-1' },
    ]);
  });

  it('invalidates every XML variant for one task through the task prefix', async () => {
    const client = new QueryClient();
    const finalKey = queryKeys.xml.content('task-1', 'final');
    const sharedKey = queryKeys.xml.content('task-1', 'current', 'share-1');
    const otherTaskKey = queryKeys.xml.content('task-2', 'final');

    client.setQueryData(finalKey, '<score />');
    client.setQueryData(sharedKey, '<score />');
    client.setQueryData(otherTaskKey, '<score />');

    await client.invalidateQueries({ queryKey: queryKeys.xml.task('task-1') });

    expect(client.getQueryState(finalKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(sharedKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherTaskKey)?.isInvalidated).toBe(false);
  });

  it('keeps owner and shared task details distinct under one task prefix', async () => {
    const client = new QueryClient();
    const ownerKey = queryKeys.tasks.detail('task-1');
    const sharedKey = queryKeys.tasks.detail('task-1', 'share-1');
    const otherTaskKey = queryKeys.tasks.detail('task-2');

    client.setQueryData(ownerKey, { owner: true });
    client.setQueryData(sharedKey, { owner: false });
    client.setQueryData(otherTaskKey, { owner: true });

    await client.invalidateQueries({ queryKey: queryKeys.tasks.task('task-1') });

    expect(client.getQueryState(ownerKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(sharedKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherTaskKey)?.isInvalidated).toBe(false);
  });
});
