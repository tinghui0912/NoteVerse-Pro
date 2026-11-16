import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QueryClient, type QueryKey } from '@tanstack/react-query';
import type { ScoreRead, PerformanceTakesListResponse } from '@/generated/api';
import { queryKeys as keys } from '@/lib/query-client';
import {
  scoreUpdated,
  scoreRevisionChanged,
  scoreRevisionWritten,
  revisionNoteChanged,
  scoreDerivedAssetsChanged,
  scoreMetadataProjectionChanged,
  scoreLeft,
  scoresDeleted,
  guestPreviewSettingsUpdated,
} from '@/lib/cache-effects/scores';
import {
  importJobChanged,
  importSubmitted,
  importDeleted,
  reviewUpdated,
  reviewConfirmed,
} from '@/lib/cache-effects/imports';
import { notificationsChanged } from '@/lib/cache-effects/notifications';
import { scoreInvitesChanged, scoreMembersChanged, inviteAccepted, pendingInviteDeclined } from '@/lib/cache-effects/collaboration';
import { libraryOrganizationChanged } from '@/lib/cache-effects/library';
import { performanceTakeDeleted, performanceTakeSaved } from '@/lib/cache-effects/performance-takes';
import { applyRealtimeCacheChange, serverStateResyncRequired } from '@/lib/cache-effects/realtime';
import { accountSessionsChanged } from '@/lib/cache-effects/account';
import { storageUsageChanged } from '@/lib/cache-effects/storage';

let client: QueryClient;
beforeEach(() => { client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } }); });
afterEach(() => client.clear());
const seed = (key: QueryKey, data: unknown = { cached: true }) => { client.setQueryData(key, data); return key; };
const stale = (key: QueryKey) => client.getQueryState(key)?.isInvalidated;
const scoreKeys = (id: string) => [keys.scores.detail(id), keys.scores.revisions(id), keys.scores.revision(id, 'r1'), keys.scores.revisionAssets(id), keys.scores.revisionAssets(id, 'r1'), keys.scores.revisionAssets(id, 'r2'), keys.scores.invites(id), keys.scores.members(id), keys.scores.guestPreviewSettings(id)];
const library = () => seed(keys.library.scoreList({ page: 1, pageSize: 20 }));
const storage = () => seed(keys.storageUsage.current());
const score = { score_id: 'a', display_title: 'Renamed', genres: [], head_revision_id: 'r1', metadata: null, input_assets: [], metadata_version: 2, head_revision_number: 2,
  capabilities: { can_view: true, can_edit: true, can_delete: true, can_leave: false, can_manage_members: true, can_manage_guest_previews: true, can_download: true, can_practice: true },
  derived_assets: { preview: { status: 'pending', asset_id: null }, audio: { status: 'pending', asset_id: null } }, created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z' } satisfies ScoreRead;

describe('Score semantic consequences', () => {
  it('replaces the exact PATCH representation and makes Library scores stale', async () => {
    const target = seed(keys.scores.detail('a')); const other = seed(keys.scores.detail('b'));
    const list = library(); const folders = seed(keys.library.folders());
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
    const matching = [seed(keys.scores.revisionAssets('a', 'r1')), seed(keys.scores.revisionAssets('a')), seed(['scores', 'revision-assets', { scoreId: 'a', revisionId: undefined }])];
    const untouched = [seed(keys.scores.revisionAssets('a', 'r2')), seed(keys.scores.revisionAssets('b', 'r1')), seed(keys.scores.revisions('a'))];
    const detail = seed(keys.scores.detail('a')); const list = library();
    await scoreDerivedAssetsChanged(client, 'a', 'r1');
    expect(matching.map(stale)).toEqual([true, true, true]); expect(untouched.map(stale)).toEqual([false, false, false]);
    expect(stale(detail)).toBe(true); expect(stale(list)).toBe(true);
  });
  it('keeps metadata projection and revision-note consequences distinct', async () => {
    const detail = seed(keys.scores.detail('a')); const list = library();
    const revisions = [seed(keys.scores.revisions('a')), seed(keys.scores.revision('a', 'r1'))];
    const assets = seed(keys.scores.revisionAssets('a'));
    await scoreMetadataProjectionChanged(client, 'a');
    expect([detail, list, ...revisions, assets].map(stale)).toEqual([true, true, false, false, false]);
    await revisionNoteChanged(client, 'a'); expect(revisions.map(stale)).toEqual([true, true]);
  });
  it.each(['leave', 'delete'])('removes only target Score identities for %s', async (operation) => {
    const removed = scoreKeys('a').map((key) => seed(key)); const kept = scoreKeys('b').map((key) => seed(key));
    kept.push(seed(keys.scores.myInvites()), seed(keys.scores.inviteAccess('token')), seed(keys.scores.guestPreview('token')));
    const list = library(); const folders = seed(keys.library.folders());
    const jobs = seed(keys.importJobs.list(1, 20)); const usage = storage();
    await (operation === 'leave' ? scoreLeft(client, 'a') : scoresDeleted(client, ['a']));
    expect(removed.every((key) => client.getQueryState(key) === undefined)).toBe(true);
    expect(kept.every((key) => client.getQueryState(key) !== undefined && !stale(key))).toBe(true);
    expect(stale(list)).toBe(true); expect(stale(folders)).toBe(true);
    expect(stale(jobs)).toBe(operation === 'delete'); expect(stale(usage)).toBe(operation === 'delete');
  });
  it('replaces only the exact Guest Preview settings representation', () => {
    const target = seed(keys.scores.guestPreviewSettings('a')); const other = seed(keys.scores.guestPreviewSettings('b'));
    const publicPreview = seed(keys.scores.guestPreview('token')); const settings = { token: 'token', enabled: true };
    guestPreviewSettingsUpdated(client, 'a', settings);
    expect(client.getQueryData(target)).toEqual(settings);
    expect(client.getQueryData(other)).toEqual({ cached: true }); expect(stale(publicPreview)).toBe(false);
  });
});

describe('Import semantic consequences', () => {
  it('converges collection plus matching detail and Review without touching other jobs', async () => {
    const changed = [seed(keys.importJobs.list(1, 20)), seed(keys.importJobs.detail('a')), seed(keys.review.detail('a'))];
    const others = [seed(keys.importJobs.detail('b')), seed(keys.review.detail('b'))];
    await importJobChanged(client, 'a');
    expect(changed.map(stale)).toEqual([true, true, true]); expect(others.map(stale)).toEqual([false, false]);
  });
  it('uses collection-only convergence for submission and retry', async () => {
    const list = seed(keys.importJobs.list(1, 20)); const detail = seed(keys.importJobs.detail('a'));
    await importSubmitted(client); expect(stale(list)).toBe(true); expect(stale(detail)).toBe(false);
  });
  it('removes deleted detail/Review and refreshes collections plus storage', async () => {
    const removed = [seed(keys.importJobs.detail('a')), seed(keys.review.detail('a'))];
    const other = seed(keys.importJobs.detail('b')); const list = seed(keys.importJobs.list(1, 20)); const usage = storage();
    await importDeleted(client, 'a');
    expect(removed.map((key) => client.getQueryState(key))).toEqual([undefined, undefined]);
    expect([other, list, usage].map(stale)).toEqual([false, true, true]);
  });
  it('converges Review updates across the matching Job, Review, collection and storage', async () => {
    const changed = [
      seed(keys.importJobs.list(1, 20)),
      seed(keys.importJobs.list(2, 20)),
      seed(keys.importJobs.detail('job-a')),
      seed(keys.review.detail('job-a')),
      storage(),
    ];
    const unchanged = [
      seed(keys.importJobs.detail('job-b')),
      seed(keys.review.detail('job-b')),
      library(),
      seed(keys.scores.detail('score')),
    ];

    await reviewUpdated(client, 'job-a');

    expect(changed.map(stale)).toEqual(Array(changed.length).fill(true));
    expect(unchanged.map(stale)).toEqual(Array(unchanged.length).fill(false));
  });
  it('combines confirmation projections without changing other Review details', async () => {
    const changed = [seed(keys.importJobs.list(1, 20)), seed(keys.importJobs.detail('job')), seed(keys.review.detail('job')), library(), seed(keys.scores.detail('score')), storage()];
    const other = seed(keys.review.detail('other'));
    await reviewConfirmed(client, 'job', 'score'); expect(changed.map(stale)).toEqual(Array(6).fill(true)); expect(stale(other)).toBe(false);
  });
});

it('keeps notifications and Collaboration collections independent', async () => {
  const notices = [seed(keys.notifications.list()), seed(keys.notifications.unreadCount())];
  const invites = seed(keys.scores.invites('a')); const members = seed(keys.scores.members('a')); const pending = seed(keys.scores.myInvites());
  const detail = seed(keys.scores.detail('a')); const list = library();
  await notificationsChanged(client);
  expect(notices.map(stale)).toEqual([true, true]); expect([invites, members, pending].map(stale)).toEqual([false, false, false]);
  await scoreInvitesChanged(client, 'a'); expect(stale(invites)).toBe(true); expect(stale(members)).toBe(false);
  await scoreMembersChanged(client, 'a'); expect(stale(members)).toBe(true); expect(stale(detail)).toBe(false);
  await pendingInviteDeclined(client); expect(stale(pending)).toBe(true); expect(stale(list)).toBe(false);
  await inviteAccepted(client, 'a'); expect(stale(list)).toBe(true); expect(stale(detail)).toBe(true);
});

it('converges Library organization, persisted storage and account sessions within their domains', async () => {
  const list = library(); const folders = seed(keys.library.folders()); const usage = storage(); const sessions = seed(keys.account.sessions());
  await libraryOrganizationChanged(client); expect([list, folders, usage].map(stale)).toEqual([true, true, false]);
  await storageUsageChanged(client); expect(stale(usage)).toBe(true); expect(stale(sessions)).toBe(false);
  await accountSessionsChanged(client); expect(stale(sessions)).toBe(true);
});

it('surgically removes a Take and preserves other Score totals before background refresh', async () => {
  const take = { take_id: 'take', linked_score_id: 'a' }; const other = { take_id: 'other', linked_score_id: 'b' };
  const all = seed(keys.performanceTakes.list(), { items: [take, other], total: 2, offset: 0, limit: 20, has_more: false });
  const matching = seed(keys.performanceTakes.list({ score_id: 'a' }), { items: [take], total: 1, offset: 0, limit: 20, has_more: false });
  const unrelated = seed(keys.performanceTakes.list({ score_id: 'b' }), { items: [other], total: 1, offset: 0, limit: 20, has_more: false });
  const detail = seed(keys.performanceTakes.detail('take'), take); const playback = seed(keys.performanceTakes.playbackUrl('take'));
  const usage = storage();
  await performanceTakeDeleted(client, 'take');
  expect(client.getQueryData<PerformanceTakesListResponse>(all)).toMatchObject({ items: [other], total: 1, has_more: false });
  expect(client.getQueryData<PerformanceTakesListResponse>(matching)).toMatchObject({ items: [], total: 0, has_more: false });
  expect(client.getQueryData<PerformanceTakesListResponse>(unrelated)).toMatchObject({ items: [other], total: 1 });
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
  const notice = seed(keys.notifications.list()); const job = seed(keys.importJobs.detail('job')); const detail = seed(keys.scores.detail('a'));
  await applyRealtimeCacheChange(client, { schemaVersion: 1, sequence: 1, changeId: 'id', createdAt: '2026-07-01T00:00:00Z', ...change });
  expect(stale(notice)).toBe(change.kind === 'notifications.changed');
  expect(stale(job)).toBe(change.kind === 'import_jobs.changed'); expect(stale(detail)).toBe(change.kind.startsWith('score.'));
});

it('broadly resynchronizes all cached server state', async () => {
  const cached = [library(), storage(), seed(keys.importJobs.detail('job')), seed(keys.notifications.list()), seed(keys.account.sessions())];
  await serverStateResyncRequired(client); expect(cached.map(stale)).toEqual(Array(cached.length).fill(true));
});
