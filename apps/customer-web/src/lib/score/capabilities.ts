import type { ScoreCapabilities } from '@/generated/api';

export type ScoreCapabilitySet = ScoreCapabilities;

export const READONLY_SCORE_CAPABILITIES: ScoreCapabilitySet = {
  can_view: true,
  can_edit: false,
  can_delete: false,
  can_manage_sharing: false,
  can_manage_members: false,
  can_download: false,
  can_practice: false,
  can_publish: false,
};

export function resolveScoreCapabilities(
  capabilities?: ScoreCapabilities | null
): ScoreCapabilitySet {
  return capabilities ?? READONLY_SCORE_CAPABILITIES;
}
