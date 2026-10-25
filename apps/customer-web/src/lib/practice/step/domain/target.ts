import type { ExpectedPracticeGroup, PracticeAttackStep, PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';

export function groupForStep(
  artifact: PracticeScoreArtifact,
  stepIndex: number
): ExpectedPracticeGroup | null {
  return artifact.expectedPracticeGroups[stepIndex] ?? null;
}

export function attackPitchesForStep(step: PracticeAttackStep): string[] {
  return step.attackTargets.map((target) => target.pitch);
}

export function continuationPitchesForStep(step: PracticeAttackStep): string[] {
  return Array.from(new Set(step.continuation.map((note) => note.pitch)));
}
