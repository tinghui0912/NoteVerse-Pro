import { accountQueryKeys } from '@/features/account/query-keys';
import { notificationQueryKeys } from '@/features/notifications/query-keys';
import { guestPreviewQueryKeys } from '@/features/scores/guest-preview/query-keys';
import { collaborationQueryKeys } from '@/features/scores/collaboration/query-keys';
import { scoreQueryKeys } from '@/features/scores/core/query-keys';
import { libraryQueryKeys } from '@/features/library/query-keys';
import { importQueryKeys } from '@/features/imports/query-keys';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QueryClient, type QueryKey } from '@tanstack/react-query';
import type { ScoreRead, PerformanceTakesListResponse } from '@/generated/api';
import { queryKeys as keys } from '@/lib/query-client';
import { scoreUpdated, scoreRevisionChanged, scoreRevisionWritten, revisionNoteChanged, scoreDerivedAssetsChanged, scoreMetadataProjectionChanged } from '@/features/scores/core/cache';
import { scoreLeft, scoresDeleted } from '@/features/scores/consequences';
import { guestPreviewSettingsUpdated } from '@/features/scores/guest-preview/cache';
import {
  importJobChanged,
  importSubmitted,
  importDeleted,
  reviewUpdated,
  reviewConfirmed,
} from '@/features/imports/cache';
import { notificationsChanged } from '@/features/notifications/cache';
import { scoreInvitesChanged, scoreMembersChanged, pendingInvitesChanged } from '@/features/scores/collaboration/cache';
import { inviteAccepted } from '@/features/scores/consequences';
import { libraryOrganizationChanged } from '@/features/library/cache';
import { performanceTakeDeleted, performanceTakeSaved } from '@/lib/cache-effects/performance-takes';
import { applyRealtimeCacheChange, serverStateResyncRequired } from '@/lib/cache-effects/realtime';
import { accountSessionsChanged } from '@/features/account/cache';
import { storageUsageChanged } from '@/lib/cache-effects/storage';

let client: QueryClient;
beforeEach(() => { client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } }); });
afterEach(() => client.clear());
const seed = (key: QueryKey, data: unknown = { cached: true }) => { client.setQueryData(key, data); return key; };
const stale = (key: QueryKey) => client.getQueryState(key)?.isInvalidated;
const scoreKeys = (id: string) => [scoreQueryKeys.detail(id), scoreQueryKeys.revisions(id), scoreQueryKeys.revision(id, 'r1'), scoreQueryKeys.revisionAssets(id), scoreQueryKeys.revisionAssets(id, 'r1'), scoreQueryKeys.revisionAssets(id, 'r2'), collaborationQueryKeys.invites(id), collaborationQueryKeys.members(id), guestPreviewQueryKeys.settings(id)];
const library = () => seed(libraryQueryKeys.scoreList({ page: 1, pageSize: 20 }));
const storage = () => seed(keys.storageUsage.current());
const score = { score_id: 'a', display_title: 'Renamed', genres: [], head_revision_id: 'r1', metadata: null, input_assets: [], metadata_version: 2, head_revision_number: 2,
  capabilities: { can_view: true, can_edit: true, can_delete: true, can_leave: false, can_manage_members: true, can_manage_guest_previews: true, can_download: true, can_practice: true },
  derived_assets: { preview: { status: 'pending', asset_id: null }, audio: { status: 'pending', asset_id: null } }, created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z' } satisfies ScoreRead;

describe('Score semantic consequences', () => {
  it('replaces the exact PATCH representation and makes Library scores stale', async () => {
    const target = seed(scoreQueryKeys.detail('a')); const other = seed(scoreQueryKeys.detail('b'));
    const list = library(); const folders = seed(libraryQueryKeys.folders());
    await scoreUpdated(client, score);
    expect(client.getQueryData(target)).toEqual(score);
    expect([target, other, list, folders].map(stale)).toEqual([false, false, true, false]);
  });
  it('invalidates revision/content and all asset variants only for the changed Score', async () => {
    const target = scoreKeys('a').map((key) => seed(key)); const other = scoreKeys('b').map((key) => seed(key));
    const list = library(); const usage = storage();
    await scoreRevisionChanged(client, 'a');
    expect(target.slice(0, 6).map(stale)).toEqual(Array(6).fill(true));
    expect(target.slice(6).map(stale)).toEqual(Array(3).fill(false));
    expect(other.map(stale)).toEqual(Array(other.length).fill(false));
    expect(stale(list)).toBe(true); expect(stale(usage)).toBe(false);
    await scoreRevisionWritten(client, 'a'); expect(stale(usage)).toBe(true);
  });
  it('matches derived assets to the revision plus null/undefined head identities', async () => {
    const matching = [seed(scoreQueryKeys.revisionAssets('a', 'r1')), seed(scoreQueryKeys.revisionAssets('a')), seed(['scores', 'revision-assets', { scoreId: 'a', revisionId: undefined }])];
    const untouched = [seed(scoreQueryKeys.revisionAssets('a', 'r2')), seed(scoreQueryKeys.revisionAssets('b', 'r1')), seed(scoreQueryKeys.revisions('a'))];
    const detail = seed(scoreQueryKeys.detail('a')); const list = library();
    await scoreDerivedAssetsChanged(client, 'a', 'r1');
    expect(matching.map(stale)).toEqual([true, true, true]); expect(untouched.map(stale)).toEqual([false, false, false]);
    expect(stale(detail)).toBe(true); expect(stale(list)).toBe(true);
  });
  it('keeps metadata projection and revision-note consequences distinct', async () => {
    const detail = seed(scoreQueryKeys.detail('a')); const list = library();
    const revisions = [seed(scoreQueryKeys.revisions('a')), seed(scoreQueryKeys.revision('a', 'r1'))];
    const assets = seed(scoreQueryKeys.revisionAssets('a'));
    await scoreMetadataProjectionChanged(client, 'a');
    expect([detail, list, ...revisions, assets].map(stale)).toEqual([true, true, false, false, false]);
    await revisionNoteChanged(client, 'a'); expect(revisions.map(stale)).toEqual([true, true]);
  });
  it.each(['leave', 'delete'])('removes only target Score identities for %s', async (operation) => {
    const target = scoreKeys('a').map((key) => seed(key)); const removed = operation === 'delete' ? target : target.slice(0, -1); const kept = [...scoreKeys('b').map((key) => seed(key)), ...(operation === 'leave' ? target.slice(-1) : [])];
    const accountInvites = [seed(collaborationQueryKeys.myInvites()), seed(collaborationQueryKeys.inviteAccess('token'))];
    const bearer = seed(guestPreviewQueryKeys.public('token'));
    const list = library(); const folders = seed(libraryQueryKeys.folders());
    const jobs = seed(importQueryKeys.jobs.list(1, 20)); const usage = storage();
    await (operation === 'leave' ? scoreLeft(client, 'a') : scoresDeleted(client, ['a']));
    expect(removed.every((key) => client.getQueryState(key) === undefined)).toBe(true);
    expect(kept.every((key) => client.getQueryState(key) !== undefined)).toBe(true);
    expect(stale(bearer)).toBe(operation === 'delete');
    expect(accountInvites.map(stale)).toEqual([operation === 'delete', operation === 'delete']);
    expect(kept.filter((key) => key[0] !== guestPreviewQueryKeys.all[0]).every((key) => stale(key) === (operation === 'delete' && key[0] === collaborationQueryKeys.all[0]))).toBe(true);
    expect(stale(list)).toBe(true); expect(stale(folders)).toBe(true);
    expect(stale(jobs)).toBe(operation === 'delete'); expect(stale(usage)).toBe(operation === 'delete');
  });
  it('updates exact Guest Preview settings and invalidates bearer projections', () => {
    const target = seed(guestPreviewQueryKeys.settings('a')); const other = seed(guestPreviewQueryKeys.settings('b'));
    const publicPreview = seed(guestPreviewQueryKeys.public('token')); const settings = { enabled: true, issued_at: '2026-11-17T00:00:00Z' };
    guestPreviewSettingsUpdated(client, 'a', settings);
    expect(client.getQueryData(target)).toEqual(settings);
    expect(client.getQueryData(other)).toEqual({ cached: true }); expect(stale(publicPreview)).toBe(true);
  });
});

describe('Import semantic consequences', () => {
  it('converges collection plus matching detail and Review without touching other jobs', async () => {
    const changed = [seed(importQueryKeys.jobs.list(1, 20)), seed(importQueryKeys.jobs.detail('a')), seed(importQueryKeys.review('a'))];
    const others = [seed(importQueryKeys.jobs.detail('b')), seed(importQueryKeys.review('b'))];
    await importJobChanged(client, 'a');
    expect(changed.map(stale)).toEqual([true, true, true]); expect(others.map(stale)).toEqual([false, false]);
  });
  it('uses collection-only convergence for submission and retry', async () => {
    const list = seed(importQueryKeys.jobs.list(1, 20)); const detail = seed(importQueryKeys.jobs.detail('a'));
    await importSubmitted(client); expect(stale(list)).toBe(true); expect(stale(detail)).toBe(false);
  });
  it('removes deleted detail/Review and refreshes collections plus storage', async () => {
    const removed = [seed(importQueryKeys.jobs.detail('a')), seed(importQueryKeys.review('a'))];
    const other = seed(importQueryKeys.jobs.detail('b')); const list = seed(importQueryKeys.jobs.list(1, 20)); const usage = storage();
    await importDeleted(client, 'a');
    expect(removed.map((key) => client.getQueryState(key))).toEqual([undefined, undefined]);
    expect([other, list, usage].map(stale)).toEqual([false, true, true]);
  });
  it('converges Review updates across the matching Job, Review, collection and storage', async () => {
    const changed = [
      seed(importQueryKeys.jobs.list(1, 20)),
      seed(importQueryKeys.jobs.list(2, 20)),
      seed(importQueryKeys.jobs.detail('job-a')),
      seed(importQueryKeys.review('job-a')),
      storage(),
    ];
    const unchanged = [
      seed(importQueryKeys.jobs.detail('job-b')),
      seed(importQueryKeys.review('job-b')),
      library(),
      seed(scoreQueryKeys.detail('score')),
    ];

    await reviewUpdated(client, 'job-a');

    expect(changed.map(stale)).toEqual(Array(changed.length).fill(true));
    expect(unchanged.map(stale)).toEqual(Array(unchanged.length).fill(false));
  });
  it('combines confirmation projections without changing other Review details', async () => {
    const changed = [seed(importQueryKeys.jobs.list(1, 20)), seed(importQueryKeys.jobs.detail('job')), seed(importQueryKeys.review('job')), library(), seed(scoreQueryKeys.detail('score')), storage()];
    const other = seed(importQueryKeys.review('other'));
    await reviewConfirmed(client, 'job', 'score'); expect(changed.map(stale)).toEqual(Array(6).fill(true)); expect(stale(other)).toBe(false);
  });
});

it('keeps notifications and Collaboration collections independent', async () => {
  const notices = [seed(notificationQueryKeys.list()), seed(notificationQueryKeys.unreadCount())];
  const invites = seed(collaborationQueryKeys.invites('a')); const members = seed(collaborationQueryKeys.members('a')); const pending = seed(collaborationQueryKeys.myInvites());
  const detail = seed(scoreQueryKeys.detail('a')); const list = library();
  await notificationsChanged(client);
  expect(notices.map(stale)).toEqual([true, true]); expect([invites, members, pending].map(stale)).toEqual([false, false, false]);
  await scoreInvitesChanged(client, 'a'); expect(stale(invites)).toBe(true); expect(stale(members)).toBe(false);
  await scoreMembersChanged(client, 'a'); expect(stale(members)).toBe(true); expect(stale(detail)).toBe(false);
  await pendingInvitesChanged(client); expect(stale(pending)).toBe(true); expect(stale(list)).toBe(false);
  await inviteAccepted(client, 'a'); expect(stale(list)).toBe(true); expect(stale(detail)).toBe(true);
});

it('converges Library organization, persisted storage and account sessions within their domains', async () => {
  const list = library(); const folders = seed(libraryQueryKeys.folders()); const usage = storage(); const sessions = seed(accountQueryKeys.sessions());
  await libraryOrganizationChanged(client); expect([list, folders, usage].map(stale)).toEqual([true, true, false]);
  await storageUsageChanged(client); expect(stale(usage)).toBe(true); expect(stale(sessions)).toBe(false);
  await accountSessionsChanged(client); expect(stale(sessions)).toBe(true);
});

it('removes a Take across loaded feed pages and preserves unrelated Score feeds', async () => {
  const take = { take_id: 'take', linked_score_id: 'a' }; const other = { take_id: 'other', linked_score_id: 'b' };
  const all = seed(keys.performanceTakes.list(), { pages: [{items: [other], next_cursor: 'next'}, {items: [take], next_cursor: null}], pageParams: [undefined, 'next'] });
  const matching = seed(keys.performanceTakes.list({ score_id: 'a' }), { pages: [{items: [take], next_cursor: null}], pageParams: [undefined] });
  const unrelated = seed(keys.performanceTakes.list({ score_id: 'b' }), { pages: [{items: [other], next_cursor: null}], pageParams: [undefined] });
  const detail = seed(keys.performanceTakes.detail('take'), take); const playback = seed(keys.performanceTakes.playbackUrl('take'));
  const usage = storage();
  await performanceTakeDeleted(client, 'take');
  expect(client.getQueryData<PerformanceTakesListResponse>(all)).toMatchObject({ pages: [{items: [other], next_cursor: 'next'}, {items: [], next_cursor: null}] });
  expect(client.getQueryData<PerformanceTakesListResponse>(matching)).toMatchObject({ pages: [{items: []}] });
  expect(client.getQueryData<PerformanceTakesListResponse>(unrelated)).toMatchObject({ pages: [{items: [other]}] });
  expect(client.getQueryState(detail)).toBeUndefined(); expect(client.getQueryState(playback)).toBeUndefined();
  expect([all, matching, unrelated, usage].map(stale)).toEqual([true, true, true, true]);
  seed(detail); await performanceTakeSaved(client); expect(stale(detail)).toBe(true);
});

it.each([
  { kind: 'notifications.changed', notificationId: null } as const,
  { kind: 'score.revisions.changed', scoreId: 'a', revisionId: 'r1' } as const,
  { kind: 'score.derived_assets.changed', scoreId: 'a', revisionId: 'r1' } as const,
  { kind: 'score.metadata.changed', scoreId: 'a', revisionId: 'r1' } as const,
  { kind: 'import_jobs.changed', importJobId: 'job' } as const,
])('maps typed $kind to its semantic domain', async (change) => {
  const unread = seed(notificationQueryKeys.unreadCount()); const pending = seed(collaborationQueryKeys.myInvites());
  const notice = seed(notificationQueryKeys.list()); const job = seed(importQueryKeys.jobs.detail('job')); const detail = seed(scoreQueryKeys.detail('a'));
  await applyRealtimeCacheChange(client, { schemaVersion: 1, sequence: 1, changeId: 'id', createdAt: '2026-07-01T00:00:00Z', ...change });
  expect(stale(notice)).toBe(change.kind === 'notifications.changed');
  expect(stale(unread)).toBe(change.kind === 'notifications.changed');
  expect(stale(pending)).toBe(false);
  expect(stale(job)).toBe(change.kind === 'import_jobs.changed'); expect(stale(detail)).toBe(change.kind.startsWith('score.'));
});

it('broadly resynchronizes all cached server state', async () => {
  const cached = [library(), storage(), seed(importQueryKeys.jobs.detail('job')), seed(notificationQueryKeys.list()), seed(accountQueryKeys.sessions())];
  await serverStateResyncRequired(client); expect(cached.map(stale)).toEqual(Array(cached.length).fill(true));
});
