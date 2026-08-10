import type { ScoreDerivedAssetRead, ScoreDerivedAssetsRead } from '@/generated/api';

export function playableAudioRevisionId(
  derivedAssets: ScoreDerivedAssetsRead,
  canPractice: boolean
) {
  if (!canPractice) return null;
  if (!derivedAssets.audio.asset_id) return null;
  if (derivedAssets.audio.status !== 'ready' || derivedAssets.audio.is_fallback) return null;
  return derivedAssets.audio.revision_id;
}

export function isDerivedAssetPreparing(status: ScoreDerivedAssetRead['status']) {
  return status === 'pending' || status === 'processing';
}
