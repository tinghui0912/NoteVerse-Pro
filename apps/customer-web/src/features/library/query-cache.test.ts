import { QueryClient } from '@tanstack/react-query';
import { expect, it } from 'vitest';
import { libraryQueryKeys } from './query-keys';
import { libraryScoresChanged, libraryOrganizationChanged } from './cache';

it('owns one stable Library cache prefix with complete collection filters', () => {
  const filters = { view: 'favorites', folderId: 'folder', search: 'bach', sort: 'name_asc', page: 2, pageSize: 20 };
  expect(libraryQueryKeys.all).toEqual(['library']);
  expect(libraryQueryKeys.folders()).toEqual(['library', 'folders']);
  expect(libraryQueryKeys.scores()).toEqual(['library', 'scores']);
  expect(libraryQueryKeys.scoreList(filters)).toEqual(['library', 'scores', filters]);
});

it.each(['score_rows', 'organization'] as const)(
  '%s changes keep the correct Library invalidation scope', async (kind) => {
    const client = new QueryClient();
    const folders = libraryQueryKeys.folders();
    const lists = [
      libraryQueryKeys.scoreList({ page: 1, pageSize: 20 }),
      libraryQueryKeys.scoreList({ view: 'shared_with_me', page: 2, pageSize: 20 }),
    ];
    for (const key of [folders, ...lists]) client.setQueryData(key, { cached: true });
    if (kind === 'score_rows') await libraryScoresChanged(client);
    else await libraryOrganizationChanged(client);
    expect(lists.every((key) => client.getQueryState(key)?.isInvalidated)).toBe(true);
    expect(client.getQueryState(folders)?.isInvalidated).toBe(kind === 'organization');
    client.clear();
  },
);
