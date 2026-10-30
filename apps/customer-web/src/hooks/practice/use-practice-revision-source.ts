'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PracticeSourceArtifactRead, PracticeSourceContentRead } from '@/generated/api/types.gen';
import type { ApiResponse } from '@/lib/api-client';
import { practiceApi } from '@/lib/api';
import { performanceTakesApi } from '@/lib/api/performance-takes';
import { queryKeys } from '@/lib/query-client';
import { parsePracticeScoreArtifact, PracticeScoreContractError } from '@/lib/practice/kernel/artifact';

function isSourceId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

type SourceRequest<T> = (signal: AbortSignal) => Promise<ApiResponse<T>>;

/** Owns transport parsing and the coherent identity of both source representations. */
function useSourceRepresentations(options: {
  scoreId: string;
  revisionId: string;
  expectedArtifactId?: string;
  enabled: boolean;
  loadContent: boolean;
  artifactKey: readonly unknown[];
  contentKey: readonly unknown[];
  getArtifact: SourceRequest<PracticeSourceArtifactRead>;
  getContent: SourceRequest<PracticeSourceContentRead>;
}) {
  const artifactQuery = useQuery({
    queryKey: options.artifactKey,
    queryFn: async ({ signal }) => {
      const response = await options.getArtifact(signal);
      if (!isSourceId(response.data?.source_id)) throw new PracticeScoreContractError('Practice source artifact identity missing');
      const artifact = parsePracticeScoreArtifact(response.data.artifact);
      if (artifact.scoreId !== options.scoreId || artifact.revisionId !== options.revisionId
        || (options.expectedArtifactId && artifact.artifactId !== options.expectedArtifactId)) {
        throw new PracticeScoreContractError('Practice artifact revision identity mismatch');
      }
      return { sourceId: response.data.source_id, artifact };
    },
    enabled: options.enabled,
    staleTime: Infinity,
  });
  const contentQuery = useQuery({
    queryKey: options.contentKey,
    queryFn: async ({ signal }) => {
      const response = await options.getContent(signal);
      const content = response.data;
      if (!content || !isSourceId(content.source_id) || typeof content.content !== 'string'
        || content.score_id !== options.scoreId || content.revision_id !== options.revisionId) {
        throw new PracticeScoreContractError('Practice content revision identity mismatch');
      }
      return content;
    },
    enabled: options.enabled && options.loadContent,
  });
  const identityError = useMemo(() => {
    const artifact = artifactQuery.data, content = contentQuery.data;
    if (!options.enabled || !artifact) return null;
    if (artifact.artifact.scoreId !== options.scoreId || artifact.artifact.revisionId !== options.revisionId
      || (options.expectedArtifactId && artifact.artifact.artifactId !== options.expectedArtifactId)
      || (options.loadContent && content && (content.source_id !== artifact.sourceId
        || content.score_id !== options.scoreId || content.revision_id !== options.revisionId))) {
      return new PracticeScoreContractError('Practice source representation identity mismatch');
    }
    return null;
  }, [artifactQuery.data, contentQuery.data, options.enabled, options.scoreId, options.revisionId,
    options.expectedArtifactId, options.loadContent]);
  const error = artifactQuery.error ?? (options.loadContent ? contentQuery.error : null) ?? identityError;
  const ready = options.enabled && !error && Boolean(artifactQuery.data)
    && (!options.loadContent || Boolean(contentQuery.data));
  const artifact = ready ? artifactQuery.data!.artifact : null;
  return {
    sourceId: ready ? artifactQuery.data!.sourceId : null,
    artifact,
    content: ready && options.loadContent ? contentQuery.data!.content : null,
    artifactQuery: { ...artifactQuery, data: artifact ?? undefined,
      isError: artifactQuery.isError || Boolean(identityError), error: artifactQuery.error ?? identityError },
    contentQuery,
    error,
    isError: Boolean(error),
    isLoading: options.enabled && (artifactQuery.isLoading || (options.loadContent && contentQuery.isLoading)),
    invalid: error instanceof PracticeScoreContractError || Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'practice_score_invalid'),
  };
}

export function usePracticeRevisionSource(
  scoreId: string,
  revisionId: string | null | undefined,
  { loadContent, enabled = true }: { loadContent: boolean; enabled?: boolean },
) {
  const revision = revisionId ?? '';
  return useSourceRepresentations({
    scoreId, revisionId: revision, enabled: enabled && Boolean(scoreId && revision), loadContent,
    artifactKey: queryKeys.practice.artifact(scoreId, revision),
    contentKey: queryKeys.practice.readyContent(scoreId, revision),
    getArtifact: signal => practiceApi.getPracticeScoreArtifact(scoreId, revision, signal),
    getContent: signal => practiceApi.getPracticeReadyScoreContent(scoreId, revision, signal),
  });
}

export function usePracticeSnapshotSource(takeId: string, identity: {
  scoreId: string; revisionId: string; artifactId: string;
}, enabled: boolean) {
  return useSourceRepresentations({
    scoreId: identity.scoreId, revisionId: identity.revisionId, expectedArtifactId: identity.artifactId,
    enabled: enabled && Boolean(takeId), loadContent: true,
    artifactKey: queryKeys.performanceTakes.practiceSourceArtifact(takeId),
    contentKey: queryKeys.performanceTakes.practiceSourceContent(takeId),
    getArtifact: signal => performanceTakesApi.getPracticeSourceArtifact(takeId, signal),
    getContent: signal => performanceTakesApi.getPracticeSourceContent(takeId, signal),
  });
}
