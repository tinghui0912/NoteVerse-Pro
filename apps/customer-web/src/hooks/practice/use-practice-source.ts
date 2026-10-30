'use client';
import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useScoreDetail } from '@/hooks/queries/use-score-queries';
import { usePracticeScoreArtifact } from './use-practice-score-artifact';

/** Shared route-family source identity. A pinned artifact is the revision-wide admission contract. */
export function usePracticeSource(scoreId: string) {
  const router = useRouter(), pathname = usePathname(), query = useSearchParams();
  const scoreQuery = useScoreDetail(scoreId);
  const requested = query.get('practiceRevisionId');
  const revisionId = requested ?? scoreQuery.data?.data?.head_revision_id ?? null;
  const canPractice = scoreQuery.data?.data?.capabilities?.can_practice !== false;
  useEffect(() => {
    if (requested || !revisionId) return;
    const pinned = new URLSearchParams(query.toString());
    pinned.set('practiceRevisionId', revisionId);
    router.replace(`${pathname}?${pinned.toString()}`, { scroll: false });
  }, [requested, revisionId, query, pathname, router]);
  const artifactQuery = usePracticeScoreArtifact(scoreId, revisionId, canPractice && Boolean(requested));
  const error = artifactQuery.error;
  const invalid = Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'practice_score_invalid');
  return { scoreQuery, artifactQuery, revisionId, canPractice, invalid,
    artifact: Boolean(requested) && !invalid && !artifactQuery.isError ? artifactQuery.data ?? null : null };
}
