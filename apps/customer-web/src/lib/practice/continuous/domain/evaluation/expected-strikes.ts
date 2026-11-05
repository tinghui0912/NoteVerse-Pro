import type { ContinuousExpectedStrike } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
import { notesForIds, type PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import type { ResolvedPracticeScope } from '@/lib/practice/kernel/scope';

type ContinuousExpectedStrikeClock = {
  tickToTimeMs(tick: number): number;
};

export function buildContinuousExpectedStrikesFromTimeline(
  artifact: PracticeScoreArtifact,
  timeline: ContinuousExpectedStrikeClock,
  scope: ResolvedPracticeScope
): ContinuousExpectedStrike[] {
  const scopeStartTimeMs = timeline.tickToTimeMs(scope.startTick);
  return artifact.moments
    .slice(scope.startIndex, scope.endIndex + 1)
    .flatMap((group) => {
      const performanceTimeMs = timeline.tickToTimeMs(group.onsetTick) - scopeStartTimeMs;
      return group.attacks.map((strike) => ({
        strikeId: strike.attackId,
        groupId: group.groupId,
        pianoKey: strike.pianoKey,
        expectedPerformanceTimeMs: performanceTimeMs,
        renderNoteIds: notesForIds(artifact, strike.noteIds).map(note => note.renderNoteId),
      }));
    });
}
