'use client';
import { useQuery } from '@tanstack/react-query';
import { performanceTakesApi } from '@/lib/api/performance-takes';
import { queryKeys } from '@/lib/query-client';
import { SourceFailure } from '@/lib/practice/failure/causal-failure';
import { readPracticeSource } from '@/lib/practice/source/source-envelope';

export function usePerformanceTakePracticeSource(takeId: string, identity: {
  sourceId: string; scoreId: string; revisionId: string; artifactId: string;
}, { enabled = true }: { enabled?: boolean }) {
  const sourceQuery = useQuery({
    queryKey: [...queryKeys.performanceTakes.practiceSource(takeId, true), identity],
    queryFn: ({ signal }) => readPracticeSource(signal => performanceTakesApi.getPracticeSource(takeId, true, signal),
      { ...identity, kind: 'EXACT' }, signal),
    enabled: enabled && Boolean(takeId), staleTime: Infinity,
  });
  const error = sourceQuery.error;
  const source = enabled && !error ? sourceQuery.data : undefined;
  return { sourceQuery, sourceId: source?.sourceId ?? null, artifact: source?.artifact ?? null,
    musicXml: source?.musicXml ?? null, error, isError: sourceQuery.isError,
    isLoading: enabled && sourceQuery.isLoading,
    transportError: error instanceof SourceFailure && error.code === 'LOAD_FAILED' ? error.cause : null,
    invalid: error instanceof SourceFailure && error.code === 'INVALID_SCORE' };
}
