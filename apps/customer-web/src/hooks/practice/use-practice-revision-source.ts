'use client';

import { SourceFailure } from '@/lib/practice/failure/causal-failure';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PracticeSourceRead } from '@/generated/api/types.gen';
import type { ApiResponse } from '@/lib/api-client';
import { practiceApi } from '@/lib/api';
import { performanceTakesApi } from '@/lib/api/performance-takes';
import { queryKeys } from '@/lib/query-client';
import { parsePracticeScoreArtifact, PracticeScoreContractError } from '@/lib/practice/kernel/artifact';

type SourceIdentity =
  | { kind: 'REVISION'; scoreId: string; revisionId: string }
  | { kind: 'EXACT'; sourceId: string; scoreId: string; revisionId: string; artifactId: string };


/** Maps one source envelope into the runtime artifact and optional presentation notation. */
function parseSource(value: PracticeSourceRead | undefined, identity: SourceIdentity, loadNotation: boolean) {
  if (!value || typeof value.source_id !== 'string' || !value.source_id) {
    throw new PracticeScoreContractError('Practice source identity missing');
  }
  if (identity.kind === 'EXACT' && (typeof identity.sourceId !== 'string' || !identity.sourceId || value.source_id !== identity.sourceId)) {
    throw new PracticeScoreContractError('Practice source identity mismatch');
  }
  const artifact = parsePracticeScoreArtifact(value.artifact);
  if (artifact.scoreId !== identity.scoreId || artifact.revisionId !== identity.revisionId
    || (identity.kind === 'EXACT' && artifact.artifactId !== identity.artifactId)) {
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
  const client = useQueryClient();
  const queryKey = [...options.queryKey, options.identity];
  const sourceQuery = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      try {
        const response = await options.request(signal);
        return parseSource(response.data, options.identity, options.loadNotation);
      } catch (cause) {
        if (cause instanceof SourceFailure) throw cause;
        const invalid = cause instanceof PracticeScoreContractError || Boolean(cause && typeof cause === 'object'
          && 'code' in cause && cause.code === 'practice_score_invalid');
        throw new SourceFailure(invalid ? 'INVALID_SCORE' : 'LOAD_FAILED', { cause });
      }
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
    loadFresh: async (signal: AbortSignal) => {
      signal.throwIfAborted();
      await client.cancelQueries({ queryKey, exact: true });
      signal.throwIfAborted();
      const response = await sourceQuery.refetch();
      signal.throwIfAborted();
      return response;
    },
    error,
    transportError: error instanceof SourceFailure && error.code === 'LOAD_FAILED' ? error.cause : null,
    isError: sourceQuery.isError,
    isLoading: options.enabled && sourceQuery.isLoading,
    invalid: error instanceof SourceFailure && error.code === 'INVALID_SCORE',
  };
}

export function usePracticeRevisionSource(
  scoreId: string,
  revisionId: string | null | undefined,
  { loadNotation, enabled = true }: { loadNotation: boolean; enabled?: boolean },
) {
  const revision = revisionId ?? '';
  return useSourceQuery({
    identity: { kind: 'REVISION', scoreId, revisionId: revision },
    enabled: enabled && Boolean(scoreId && revision), loadNotation,
    queryKey: queryKeys.practice.source(scoreId, revision, loadNotation),
    request: signal => practiceApi.getPracticeSource(scoreId, revision, loadNotation, signal),
  });
}

export function usePracticeSourceById(sourceId: string, identity: { scoreId: string; revisionId: string; artifactId: string },
  { loadNotation, enabled = true }: { loadNotation: boolean; enabled?: boolean }) {
  return useSourceQuery({
    identity: { ...identity, kind: 'EXACT', sourceId }, enabled: enabled && Boolean(sourceId), loadNotation,
    queryKey: queryKeys.practice.sourceById(sourceId, loadNotation),
    request: signal => practiceApi.getPracticeSourceById(sourceId, loadNotation, signal),
  });
}

export function usePerformanceTakePracticeSource(takeId: string, identity: {
  sourceId: string; scoreId: string; revisionId: string; artifactId: string;
}, { loadNotation, enabled = true }: { loadNotation: boolean; enabled?: boolean }) {
  return useSourceQuery({
    identity: { ...identity, kind: 'EXACT' }, enabled: enabled && Boolean(takeId), loadNotation,
    queryKey: queryKeys.performanceTakes.practiceSource(takeId, loadNotation),
    request: signal => performanceTakesApi.getPracticeSource(takeId, loadNotation, signal),
  });
}
