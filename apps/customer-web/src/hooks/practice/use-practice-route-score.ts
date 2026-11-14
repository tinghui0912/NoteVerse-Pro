'use client';
import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useScoreDetail } from '@/hooks/queries/use-score-queries';

/** Route metadata and revision pinning only; never admits a Practice Bundle. */
export function usePracticeRouteScore(scoreId: string) {
  const router = useRouter(), pathname = usePathname(), query = useSearchParams();
  const scoreQuery = useScoreDetail(scoreId);
  const requested = query.get('practiceRevisionId');
  const revisionId = requested ?? scoreQuery.data?.head_revision_id ?? null;
  const canPractice = scoreQuery.data?.capabilities?.can_practice !== false;
  useEffect(() => {
    if (requested || !revisionId) return;
    const pinned = new URLSearchParams(query.toString());
    pinned.set('practiceRevisionId', revisionId);
    router.replace(`${pathname}?${pinned.toString()}`, { scroll: false });
  }, [requested, revisionId, query, pathname, router]);
  return { scoreQuery, revisionId, canPractice, pinned: Boolean(requested) };
}
