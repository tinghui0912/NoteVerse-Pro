'use client';
import { useQuery } from '@tanstack/react-query';
import { practiceApi } from '@/lib/api/practice';
import { queryKeys } from '@/lib/query-client';
import { SourceFailure } from '@/lib/practice/failure/causal-failure';
import { readPracticeSource } from '@/lib/practice/source/source-envelope';

export function useSavedTakeExportSource(identity: {
  sourceId: string; scoreId: string; revisionId: string; artifactId: string;
}, { enabled = true }: { enabled?: boolean }) {
  const sourceQuery = useQuery({
    queryKey: [...queryKeys.savedTakeExport.source(identity.sourceId), identity],
    queryFn: ({ signal }) => readPracticeSource(signal => practiceApi.getExactSource(identity.sourceId, signal),
      { ...identity, kind: 'EXACT' }, signal),
    enabled: enabled && Boolean(identity.sourceId),
    staleTime: 0, gcTime: 0, refetchOnMount: 'always',
  });
  const error = sourceQuery.error;
  const source = enabled && !error && !sourceQuery.isFetching ? sourceQuery.data : undefined;
  return { sourceQuery, sourceId: source?.sourceId ?? null, artifact: source?.artifact ?? null,
    musicXml: source?.musicXml ?? null, error, isError: sourceQuery.isError,
    isLoading: enabled && sourceQuery.isLoading,
    transportError: error instanceof SourceFailure && error.code === 'LOAD_FAILED' ? error.cause : null,
    invalid: error instanceof SourceFailure && error.code === 'INVALID_SCORE' };
}
