'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { scoresApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import type { ScoreArtifact } from '@/types/api';

const THUMBNAIL_KIND = 'RENDERED_PAGE';

export interface HistoryThumbnailTarget {
  id: string;
  scoreId: string;
  revisionId?: string | null;
  enabled?: boolean;
}

export interface HistoryThumbnailState {
  thumbnail: string;
  thumbnailError: boolean;
  thumbnailLoading: boolean;
}

function getLookupKey(target: Pick<HistoryThumbnailTarget, 'scoreId' | 'revisionId'>) {
  return `${target.scoreId}:${target.revisionId ?? 'latest'}`;
}

function getArtifactDownloadUrl(artifactId: string) {
  return `/api/v1/artifacts/${encodeURIComponent(artifactId)}/download`;
}

function selectThumbnailArtifact(artifacts: ScoreArtifact[] | null | undefined) {
  const renderedPages = (artifacts ?? [])
    .filter((artifact) => artifact.kind === THUMBNAIL_KIND && artifact.available)
    .sort((a, b) => (a.page_number ?? Number.MAX_SAFE_INTEGER) - (b.page_number ?? Number.MAX_SAFE_INTEGER));

  return renderedPages[0] ?? null;
}

export function useHistoryThumbnails(targets: HistoryThumbnailTarget[]) {
  const uniqueTargets = useMemo(() => {
    const byLookup = new Map<string, HistoryThumbnailTarget & { lookupKey: string }>();

    for (const target of targets) {
      if (!target.scoreId || target.enabled === false) continue;
      const lookupKey = getLookupKey(target);
      if (!byLookup.has(lookupKey)) byLookup.set(lookupKey, { ...target, lookupKey });
    }

    return Array.from(byLookup.values());
  }, [targets]);

  const queries = useQueries({
    queries: uniqueTargets.map((target) => ({
      queryKey: queryKeys.scores.artifacts(target.scoreId, target.revisionId ?? undefined, THUMBNAIL_KIND),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        scoresApi.artifacts(
          target.scoreId,
          { revision_id: target.revisionId ?? undefined, kind: THUMBNAIL_KIND },
          signal
        ),
      staleTime: 5 * 60 * 1000,
    })),
  });

  const statesByLookup = new Map<string, HistoryThumbnailState>();
  uniqueTargets.forEach((target, index) => {
    const query = queries[index];
    const artifact = selectThumbnailArtifact(query?.data?.data);
    statesByLookup.set(target.lookupKey, {
      thumbnail: artifact ? getArtifactDownloadUrl(artifact.artifact_id) : '',
      thumbnailError: Boolean(query?.isError),
      thumbnailLoading: Boolean((query?.isLoading || query?.isFetching) && !query?.data),
    });
  });

  return targets.reduce<Record<string, HistoryThumbnailState>>((states, target) => {
    if (!target.scoreId || target.enabled === false) {
      states[target.id] = { thumbnail: '', thumbnailError: false, thumbnailLoading: false };
      return states;
    }

    states[target.id] = statesByLookup.get(getLookupKey(target)) ?? {
      thumbnail: '',
      thumbnailError: false,
      thumbnailLoading: false,
    };
    return states;
  }, {});
}
