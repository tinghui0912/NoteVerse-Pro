import { QueryClient } from '@tanstack/react-query';
import { expect, it } from 'vitest';
import { scoreQueryKeys } from './core/query-keys';
import { collaborationQueryKeys } from './collaboration/query-keys';
import { guestPreviewQueryKeys } from './guest-preview/query-keys';
import { scoresDeleted, scoreLeft, inviteAccepted } from './consequences';
import { libraryQueryKeys } from '@/features/library/query-keys';
import { importQueryKeys } from '@/features/imports/query-keys';
import { queryKeys } from '@/lib/query-client';

it.each(['delete', 'leave'] as const)('%s converges exactly its lifecycle authorities', async (operation) => {
  const client = new QueryClient();
  const removed = [scoreQueryKeys.detail('score'), scoreQueryKeys.revision('score', 'revision'), scoreQueryKeys.revisionAssets('score'), collaborationQueryKeys.invites('score'), collaborationQueryKeys.members('score')];
  const imports = [importQueryKeys.jobs.list(1, 20), importQueryKeys.jobs.detail('job'), importQueryKeys.review('job')];
  const guestSettings = guestPreviewQueryKeys.settings('score');
  const bearers = [guestPreviewQueryKeys.public('first'), guestPreviewQueryKeys.public('unmapped')];
  const library = [libraryQueryKeys.folders(), libraryQueryKeys.scoreList({ page: 1, pageSize: 20 })];
  const storage = queryKeys.storageUsage.current();
  const history = queryKeys.performanceTakes.list();
  const other = [scoreQueryKeys.detail('other'), collaborationQueryKeys.members('other')];
  for (const key of [...removed, ...imports, guestSettings, ...bearers, ...library, storage, history, ...other]) client.setQueryData(key, { cached: true });
  if (operation === 'delete') await scoresDeleted(client, ['score']);
  else await scoreLeft(client, 'score');
  expect(removed.every((key) => !client.getQueryState(key))).toBe(true);
  expect(imports.every((key) => client.getQueryState(key)?.isInvalidated === (operation === 'delete'))).toBe(true);
  expect(bearers.every((key) => client.getQueryState(key)?.isInvalidated === (operation === 'delete'))).toBe(true);
  if (operation === 'delete') expect(client.getQueryState(guestSettings)).toBeUndefined();
  else expect(client.getQueryState(guestSettings)?.isInvalidated).toBe(false);
  expect(library.every((key) => client.getQueryState(key)?.isInvalidated)).toBe(true);
  expect(client.getQueryState(storage)?.isInvalidated).toBe(operation === 'delete');
  expect([...other, history].every((key) => client.getQueryState(key)?.isInvalidated === false)).toBe(true);
  client.clear();
});

it('acceptance refreshes access and invitation projections without becoming a Score mutation', async () => {
  const client = new QueryClient();
  const changed = [collaborationQueryKeys.myInvites(), collaborationQueryKeys.invites('score'), collaborationQueryKeys.members('score'), collaborationQueryKeys.inviteAccess('token'), scoreQueryKeys.detail('score'), libraryQueryKeys.scoreList({ page: 1, pageSize: 20 })];
  const kept = [scoreQueryKeys.revisions('score'), scoreQueryKeys.revisionAssets('score'), guestPreviewQueryKeys.settings('score'), importQueryKeys.review('job')];
  for (const key of [...changed, ...kept]) client.setQueryData(key, { cached: true });
  await inviteAccepted(client, 'score');
  expect(changed.every((key) => client.getQueryState(key)?.isInvalidated)).toBe(true);
  expect(kept.every((key) => !client.getQueryState(key)?.isInvalidated)).toBe(true);
  client.clear();
});
