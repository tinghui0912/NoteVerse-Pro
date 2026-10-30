'use client';

import { useQuery } from '@tanstack/react-query';
import type { PracticeSourceRead } from '@/generated/api/types.gen';
import type { ApiResponse } from '@/lib/api-client';
import { practiceApi } from '@/lib/api';
import { performanceTakesApi } from '@/lib/api/performance-takes';
import { queryKeys } from '@/lib/query-client';
import { parsePracticeScoreArtifact, PracticeScoreContractError } from '@/lib/practice/kernel/artifact';

type SourceIdentity = { scoreId: string; revisionId: string; artifactId?: string };

export function isInvalidPracticeSource(error: unknown): boolean {
  return error instanceof PracticeScoreContractError || Boolean(error && typeof error === 'object'
    && 'code' in error && error.code === 'practice_score_invalid');
}

/** Maps one source envelope into the runtime artifact and optional presentation notation. */
function parseSource(value: PracticeSourceRead | undefined, identity: SourceIdentity, loadNotation: boolean) {
  if (!value || typeof value.source_id !== 'string' || !value.source_id) {
    throw new PracticeScoreContractError('Practice source identity missing');
  }
  const artifact = parsePracticeScoreArtifact(value.artifact);
  if (artifact.scoreId !== identity.scoreId || artifact.revisionId !== identity.revisionId
    || (identity.artifactId !== undefined && artifact.artifactId !== identity.artifactId)) {
    throw new PracticeScoreContractError('Practice source artifact identity mismatch');
  }
  const notation = value.notation;
  if (loadNotation ? (!notation || typeof notation.musicxml !== 'string'
      || notation.mime_type !== 'application/vnd.recordare.musicxml+xml') : notation !== null) {
    throw new PracticeScoreContractError('Practice source notation contract mismatch');
  }
  return { sourceId: value.source_id, artifact, musicXml: notation?.musicxml ?? null };
}

function useSourceQuery(options: {
  identity: SourceIdentity;
  enabled: boolean;
  loadNotation: boolean;
  queryKey: readonly unknown[];
  request: (signal: AbortSignal) => Promise<ApiResponse<PracticeSourceRead>>;
}) {
  const sourceQuery = useQuery({
    queryKey: [...options.queryKey, options.identity],
    queryFn: async ({ signal }) => {
      const response = await options.request(signal);
      return parseSource(response.data, options.identity, options.loadNotation);
    },
    enabled: options.enabled,
    staleTime: Infinity,
    ...(options.enabled ? {} : { retry: false }),
  });
  const error = sourceQuery.error;
  const source = options.enabled && !error ? sourceQuery.data : undefined;
  return {
    sourceId: source?.sourceId ?? null,
    artifact: source?.artifact ?? null,
    musicXml: source?.musicXml ?? null,
    sourceQuery,
    error,
    isError: sourceQuery.isError,
    isLoading: options.enabled && sourceQuery.isLoading,
    invalid: isInvalidPracticeSource(error),
  };
}

export function usePracticeRevisionSource(
  scoreId: string,
  revisionId: string | null | undefined,
  { loadNotation, enabled = true }: { loadNotation: boolean; enabled?: boolean },
) {
  const revision = revisionId ?? '';
  return useSourceQuery({
    identity: { scoreId, revisionId: revision },
    enabled: enabled && Boolean(scoreId && revision), loadNotation,
    queryKey: queryKeys.practice.source(scoreId, revision, loadNotation),
    request: signal => practiceApi.getPracticeSource(scoreId, revision, loadNotation, signal),
  });
}

export function usePracticeSnapshotSource(takeId: string, identity: {
  scoreId: string; revisionId: string; artifactId: string;
}, { loadNotation, enabled = true }: { loadNotation: boolean; enabled?: boolean }) {
  return useSourceQuery({
    identity, enabled: enabled && Boolean(takeId), loadNotation,
    queryKey: queryKeys.performanceTakes.practiceSource(takeId, loadNotation),
    request: signal => performanceTakesApi.getPracticeSource(takeId, loadNotation, signal),
  });
}
