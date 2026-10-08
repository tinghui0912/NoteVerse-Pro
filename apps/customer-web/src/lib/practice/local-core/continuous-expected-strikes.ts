import {
  assertPracticeScoreArtifact,
  resolvePracticeScope,
  type PracticeScoreArtifact,
  type PracticeScope,
  type ResolvedPracticeScope,
} from './artifact';
import {
  PracticeTempoTimeline,
  resolvePracticeTempoPlan,
  type PracticeTempoSelection,
} from './practice-tempo';
import type { ExpectedStrike } from '../audio-analysis/continuous/performance-reconciler';

type ContinuousExpectedStrikeClock = {
  beatToTimeMs(beat: number): number;
};

export type BuildContinuousExpectedStrikesInput = {
  artifact: PracticeScoreArtifact;
  tempoSelection: PracticeTempoSelection;
  scope: PracticeScope;
};

export function buildContinuousExpectedStrikes(input: BuildContinuousExpectedStrikesInput): ExpectedStrike[] {
  assertPracticeScoreArtifact(input.artifact);
  const tempoPlan = resolvePracticeTempoPlan(input.artifact, input.tempoSelection);
  const timeline = new PracticeTempoTimeline(tempoPlan, input.artifact.scoreEndBeat);
  const scope = resolvePracticeScope(input.artifact, input.scope);
  return buildContinuousExpectedStrikesFromTimeline(input.artifact, timeline, scope);
}

export function buildContinuousExpectedStrikesFromTimeline(
  artifact: PracticeScoreArtifact,
  timeline: ContinuousExpectedStrikeClock,
  scope: ResolvedPracticeScope
): ExpectedStrike[] {
  assertPracticeScoreArtifact(artifact);
  const scopeStartTimeMs = timeline.beatToTimeMs(scope.startBeat);
  return artifact.expectedPracticeGroups
    .slice(scope.startIndex, scope.endIndex + 1)
    .flatMap((group) => {
      const performanceTimeMs = timeline.beatToTimeMs(group.onsetBeat) - scopeStartTimeMs;
      return group.strikeTargets.map((strike) => ({
        strikeId: strike.strikeId,
        groupId: group.groupId,
        pitch: strike.pitch,
        expectedPerformanceTimeMs: performanceTimeMs,
        renderNoteIds: strike.renderNoteIds,
      }));
    });
}
