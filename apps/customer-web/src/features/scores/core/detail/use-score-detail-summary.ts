'use client';

import { useScoreDetail, useScoreRevisionAssets } from '@/features/scores/core/queries';

export function useScoreDetailSummary(scoreId: string) {
  const scoreQuery = useScoreDetail(scoreId);
  const score = scoreQuery.data;
  const revisionId = score?.head_revision_id;
  const assetsQuery = useScoreRevisionAssets(scoreId, {
    revisionId: revisionId ?? undefined,
    enabled: Boolean(revisionId),
  });
  const revisionAssets = assetsQuery.data ?? { revision_sources: [], render_assets: [] };

  return {
    revisionAssets,
    imageCount: revisionAssets.render_assets.filter((asset) => asset.kind === 'RENDERED_PAGE').length,
    score,
    scoreError: scoreQuery.error ?? assetsQuery.error,
    scoreLoading: scoreQuery.isLoading || assetsQuery.isLoading,
  };
}
