import type { ScoreDerivedAssets } from '@/types/api';

export function playableAudioRevisionId(
  derivedAssets: ScoreDerivedAssets,
  canPractice: boolean
) {
  if (!canPractice) return null;
  if (!derivedAssets.audio.asset_id) return null;
  if (derivedAssets.audio.status !== 'ready' && !derivedAssets.audio.is_fallback) return null;
  return derivedAssets.audio.revision_id;
}
