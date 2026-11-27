import { type PracticeScoreArtifact } from '@/lib/practice/score/artifact';

export type PracticeScope =
  | { kind: 'FULL' }
  | {
      kind: 'RANGE';
      startGroupId: string;
      endGroupId: string;
    };

export type ResolvedPracticeScope =
  | {
      kind: 'FULL';
      startIndex: number;
      endIndex: number;
      startTick: number;
      terminalTick: number;
    }
  | {
      kind: 'RANGE';
      startGroupId: string;
      endGroupId: string;
      startIndex: number;
      endIndex: number;
      startTick: number;
      terminalTick: number;
    };

export function resolvePracticeScope(
  artifact: PracticeScoreArtifact,
  scope: PracticeScope
): ResolvedPracticeScope {
  if (artifact.moments.length === 0) {
    throw new Error('Practice scope requires at least one expected group.');
  }

  const isRange = scope.kind === 'RANGE';
  const startIndex = isRange ? groupIndex(artifact, scope.startGroupId) : 0;
  const endIndex = isRange
    ? groupIndex(artifact, scope.endGroupId)
    : artifact.moments.length - 1;
  if (endIndex < startIndex) {
    throw new Error('Practice scope end must not be before its start.');
  }

  const startGroup = artifact.moments[startIndex];
  const endGroup = artifact.moments[endIndex];
  if (scope.kind === 'RANGE') {
    return {
      kind: 'RANGE',
      startGroupId: scope.startGroupId,
      endGroupId: scope.endGroupId,
      startIndex,
      endIndex,
      startTick: startGroup.onsetTick,
      terminalTick: entryGroupEndTick(artifact, endGroup.groupId),
    };
  }
  return {
    kind: 'FULL',
    startIndex,
    endIndex,
    startTick: startGroup.onsetTick,
    terminalTick: artifact.scoreEndTick,
  };
}

export function entryGroupEndTick(artifact: PracticeScoreArtifact, groupId: string): number {
  const group = artifact.moments.find((candidate) => candidate.groupId === groupId);
  if (!group) {
    throw new Error(`Practice scope target not found: ${groupId}`);
  }
  return (group.canonicalEndTick);
}

function groupIndex(artifact: PracticeScoreArtifact, groupId: string): number {
  const index = artifact.moments.findIndex((group) => group.groupId === groupId);
  if (index < 0) {
    throw new Error(`Practice scope target not found: ${groupId}`);
  }
  return index;
}
