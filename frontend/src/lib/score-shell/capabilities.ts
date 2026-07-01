import type { ScoreCapabilities } from '@/types/api';

export type ScoreShellCapabilities = ScoreCapabilities;

export const READONLY_SCORE_CAPABILITIES: ScoreShellCapabilities = {
  can_view: true,
  can_edit: false,
  can_delete: false,
  can_manage_sharing: false,
  can_manage_members: false,
  can_download: false,
  can_practice: false,
  can_publish: false,
  can_approve: false,
};

export function resolveScoreShellCapabilities(
  capabilities?: ScoreCapabilities | null
): ScoreShellCapabilities {
  return capabilities ?? READONLY_SCORE_CAPABILITIES;
}
