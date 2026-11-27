import type { ScoreDerivedAssetRead, ScoreDerivedAssetsRead } from '@/generated/api';

export function playableAudioRevisionId(
  derivedAssets: ScoreDerivedAssetsRead,
  canPractice: boolean,
  headRevisionId: string | null | undefined
) {
  if (!canPractice) return null;
  if (!derivedAssets.audio.asset_id) return null;
  if (derivedAssets.audio.status !== 'ready') return null;
  return headRevisionId || null;
}

export function isDerivedAssetPreparing(status: ScoreDerivedAssetRead['status']) {
  return status === 'pending' || status === 'processing';
}
