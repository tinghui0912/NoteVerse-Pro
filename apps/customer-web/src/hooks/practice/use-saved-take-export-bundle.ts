'use client';
import { useQuery } from '@tanstack/react-query';
import { practiceApi } from '@/lib/api/practice';
import { queryKeys } from '@/lib/query-client';
import { BundleFailure } from '@/lib/practice/failure/causal-failure';
import { readPracticeBundle } from '@/lib/practice/bundle/bundle-envelope';

export function useSavedTakeExportBundle(
  identity: {
    bundleId: string;
    scoreId: string;
    revisionId: string;
    artifactId: string;
  },
  { enabled = true }: { enabled?: boolean },
) {
  const bundleQuery = useQuery({
    queryKey: [
      ...queryKeys.savedTakeExport.bundle(identity.bundleId),
      identity,
    ],
    queryFn: ({ signal }) =>
      readPracticeBundle(
        (signal) =>
          practiceApi.getPracticeBundle(
            identity.scoreId,
            identity.revisionId,
            true,
            signal,
          ),
        { ...identity, kind: 'EXACT' },
        signal,
      ),
    enabled: enabled && Boolean(identity.bundleId),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  });
  const error = bundleQuery.error;
  const bundle =
    enabled && !error && !bundleQuery.isFetching ? bundleQuery.data : undefined;
  return {
    bundleQuery,
    binding: bundle?.binding ?? null,
    artifact: bundle?.artifact ?? null,
    musicXml: bundle?.musicXml ?? null,
    error,
    isError: bundleQuery.isError,
    isLoading: enabled && bundleQuery.isLoading,
    transportError:
      error instanceof BundleFailure && error.code === 'LOAD_FAILED'
        ? error.cause
        : null,
    invalid: error instanceof BundleFailure && error.code === 'INVALID_SCORE',
  };
}
