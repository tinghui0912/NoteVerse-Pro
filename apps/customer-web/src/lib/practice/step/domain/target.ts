import type { PracticePianoKey } from '@/lib/practice/kernel/piano-key';
import type { ExpectedPracticeGroup, PracticeAttackStep, PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';

export function groupForStep(
  artifact: PracticeScoreArtifact,
  stepIndex: number
): ExpectedPracticeGroup | null {
  return artifact.expectedPracticeGroups[stepIndex] ?? null;
}

export function attackKeysForStep(step: PracticeAttackStep): PracticePianoKey[] {
  return step.attackTargets.map((target) => target.pianoKey);
}

export function continuationKeysForStep(step: PracticeAttackStep): PracticePianoKey[] {
  return Array.from(new Set(step.continuation.map((note) => note.pianoKey)));
}
