'use client';

import { useQuery } from '@tanstack/react-query';

import { practiceApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';

export function usePracticeTargets(
  scoreId: string,
  revisionId: string | null | undefined,
  enabled = true
) {
  const resolvedRevisionId = revisionId ?? '';
  return useQuery({
    queryKey: queryKeys.practice.targets(scoreId, resolvedRevisionId),
    queryFn: ({ signal }) =>
      practiceApi.getPracticeTargets(scoreId, resolvedRevisionId, signal),
    enabled: enabled && Boolean(scoreId && resolvedRevisionId),
  });
}
