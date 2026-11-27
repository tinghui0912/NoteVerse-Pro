import { scoreQueryKeys } from '@/features/scores/core/query-keys';
import type { Query, QueryClient } from '@tanstack/react-query';
import type { ScoreRead } from '@/generated/api';
import { libraryScoresChanged } from '@/features/library/cache';
import { storageUsageChanged } from '@/features/storage-usage/cache';

function scoreIdentity(query: Query): string | undefined {
  const [domain, , identity] = query.queryKey;
  if (domain !== scoreQueryKeys.all[0] || !identity || typeof identity !== 'object') return;
  return 'scoreId' in identity && typeof identity.scoreId === 'string' ? identity.scoreId : undefined;
}

function invalidateRevisionAssets(client: QueryClient, scoreId: string, revisionId?: string) {
  return client.invalidateQueries({
    predicate: (query) => {
      if (scoreIdentity(query) !== scoreId || query.queryKey[1] !== scoreQueryKeys.revisionAssets(scoreId)[1]) return false;
      const identity = query.queryKey[2] as { revisionId?: unknown };
      return revisionId === undefined || identity.revisionId == null || identity.revisionId === revisionId;
    },
  });
}

export async function scoreUpdated(client: QueryClient, score: ScoreRead) {
  client.setQueryData(scoreQueryKeys.detail(score.score_id), score);
  await libraryScoresChanged(client);
}

export async function scoreRevisionChanged(client: QueryClient, scoreId: string) {
  await Promise.all([
    client.invalidateQueries({ queryKey: scoreQueryKeys.detail(scoreId), exact: true }),
    client.invalidateQueries({ queryKey: scoreQueryKeys.revisions(scoreId) }),
    invalidateRevisionAssets(client, scoreId),
    libraryScoresChanged(client),
  ]);
}

export async function scoreRevisionWritten(client: QueryClient, scoreId: string) {
  await Promise.all([scoreRevisionChanged(client, scoreId), storageUsageChanged(client)]);
}

export function revisionNoteChanged(client: QueryClient, scoreId: string) {
  return client.invalidateQueries({ queryKey: scoreQueryKeys.revisions(scoreId) });
}

export async function scoreDerivedAssetsChanged(client: QueryClient, scoreId: string, revisionId: string) {
  await Promise.all([
    client.invalidateQueries({ queryKey: scoreQueryKeys.detail(scoreId), exact: true }),
    invalidateRevisionAssets(client, scoreId, revisionId),
    libraryScoresChanged(client),
  ]);
}

export async function scoreMetadataProjectionChanged(client: QueryClient, scoreId: string) {
  await Promise.all([
    client.invalidateQueries({ queryKey: scoreQueryKeys.detail(scoreId), exact: true }),
    libraryScoresChanged(client),
  ]);
}

export function removeScoreCoreCaches(client: QueryClient, scoreIds: readonly string[]) {
  const identities = new Set(scoreIds);
  client.removeQueries({ predicate: (query) => {
    const scoreId = scoreIdentity(query);
    return scoreId !== undefined && identities.has(scoreId);
  } });
}


export function scoreDetailChanged(client: QueryClient, scoreId: string) {
  return client.invalidateQueries({ queryKey: scoreQueryKeys.detail(scoreId), exact: true });
}
