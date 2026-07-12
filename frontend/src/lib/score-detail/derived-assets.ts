import type { ScoreDerivedAssets } from '@/types/api';

export function playableAudioRevisionId(
  derivedAssets: ScoreDerivedAssets,
  canPractice: boolean
) {
  if (!canPractice) return null;
  return derivedAssets.audio.revision_id;
}
