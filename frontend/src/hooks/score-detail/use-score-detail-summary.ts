'use client';

import { useScoreArtifacts, useScoreDetail } from '@/hooks/queries/use-score-queries';

export function useScoreDetailSummary(scoreId: string) {
  const scoreQuery = useScoreDetail(scoreId);
  const score = scoreQuery.data?.data;
  const revisionId = score?.head_revision_id;
  const artifactQuery = useScoreArtifacts(scoreId, {
    revisionId: revisionId ?? undefined,
    enabled: Boolean(revisionId),
  });
  const artifacts = artifactQuery.data?.data ?? [];

  return {
    artifacts,
    imageCount: artifacts.filter((artifact) => artifact.kind === 'RENDERED_PAGE').length,
    score,
    scoreError: scoreQuery.error ?? artifactQuery.error,
    scoreLoading: scoreQuery.isLoading || artifactQuery.isLoading,
  };
}
