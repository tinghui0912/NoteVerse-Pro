import type { Query, QueryClient } from '@tanstack/react-query';
import type { GuestPreviewSettingsRead, ScoreRead } from '@/generated/api';
import { queryKeys } from '@/lib/query-client';
import { libraryOrganizationChanged, libraryScoresChanged } from './library';
import { storageUsageChanged } from './storage';

function scoreIdentity(query: Query): string | undefined {
  const [domain, , identity] = query.queryKey;
  if (domain !== queryKeys.scores.all[0] || !identity || typeof identity !== 'object') return;
  return 'scoreId' in identity && typeof identity.scoreId === 'string' ? identity.scoreId : undefined;
}

function invalidateRevisionAssets(client: QueryClient, scoreId: string, revisionId?: string) {
  return client.invalidateQueries({
    predicate: (query) => {
      if (scoreIdentity(query) !== scoreId || query.queryKey[1] !== queryKeys.scores.revisionAssets(scoreId)[1]) return false;
      const identity = query.queryKey[2] as { revisionId?: unknown };
      return revisionId === undefined || identity.revisionId == null || identity.revisionId === revisionId;
    },
  });
}

export async function scoreUpdated(client: QueryClient, score: ScoreRead) {
  client.setQueryData(queryKeys.scores.detail(score.score_id), score);
  await libraryScoresChanged(client);
}

export async function scoreRevisionChanged(client: QueryClient, scoreId: string) {
  await Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.scores.detail(scoreId), exact: true }),
    client.invalidateQueries({ queryKey: queryKeys.scores.revisions(scoreId) }),
    invalidateRevisionAssets(client, scoreId),
    libraryScoresChanged(client),
  ]);
}

export async function scoreRevisionWritten(client: QueryClient, scoreId: string) {
  await Promise.all([scoreRevisionChanged(client, scoreId), storageUsageChanged(client)]);
}

export function revisionNoteChanged(client: QueryClient, scoreId: string) {
  return client.invalidateQueries({ queryKey: queryKeys.scores.revisions(scoreId) });
}

export async function scoreDerivedAssetsChanged(client: QueryClient, scoreId: string, revisionId: string) {
  await Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.scores.detail(scoreId), exact: true }),
    invalidateRevisionAssets(client, scoreId, revisionId),
    libraryScoresChanged(client),
  ]);
}

export async function scoreMetadataProjectionChanged(client: QueryClient, scoreId: string) {
  await Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.scores.detail(scoreId), exact: true }),
    libraryScoresChanged(client),
  ]);
}

function removeScoreCaches(client: QueryClient, scoreIds: readonly string[]) {
  const identities = new Set(scoreIds);
  client.removeQueries({ predicate: (query) => {
    const scoreId = scoreIdentity(query);
    return scoreId !== undefined && identities.has(scoreId);
  } });
}

export function scoreLeft(client: QueryClient, scoreId: string) {
  removeScoreCaches(client, [scoreId]);
  return libraryOrganizationChanged(client);
}

export async function scoresDeleted(client: QueryClient, scoreIds: readonly string[]) {
  removeScoreCaches(client, scoreIds);
  await Promise.all([
    libraryOrganizationChanged(client),
    client.invalidateQueries({ queryKey: queryKeys.importJobs.all }),
    storageUsageChanged(client),
  ]);
}

export function guestPreviewSettingsUpdated(client: QueryClient, scoreId: string, settings: GuestPreviewSettingsRead) {
  client.setQueryData(queryKeys.scores.guestPreviewSettings(scoreId), settings);
}
