'use client';

import { useQuery } from '@tanstack/react-query';

import { practiceApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { parsePracticeScoreArtifact, type PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';

export function usePracticeScoreArtifact(
  scoreId: string,
  revisionId: string | null | undefined,
  enabled = true
) {
  const resolvedRevisionId = revisionId ?? '';
  return useQuery<PracticeScoreArtifact>({
    queryKey: queryKeys.practice.artifact(scoreId, resolvedRevisionId),
    queryFn: async ({ signal }) => {
      const response = await practiceApi.getPracticeScoreArtifact(
        scoreId,
        resolvedRevisionId,
        signal
      );
      if (!response.data) {
        throw new Error('PracticeScoreArtifact response missing data');
      }
      const artifact = parsePracticeScoreArtifact(response.data);
      if (artifact.scoreId !== scoreId || artifact.revisionId !== resolvedRevisionId) {
        throw new Error('Practice artifact revision identity mismatch');
      }
      return artifact;
    },
    enabled: enabled && Boolean(scoreId && resolvedRevisionId),
    staleTime: Infinity,
  });
}
