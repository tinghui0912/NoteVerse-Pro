import type { ShareVideoSession } from './session';
import type { PerformanceRecording } from '@/lib/practice/recording/recording-artifact';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import type { ResolvedPracticeScope } from '@/lib/practice/kernel/scope';
import type { ResolvedPracticeTempoPlan } from '@/lib/practice/kernel/tempo';
import { cursorScopeFromResolvedPracticeScope, resolvePracticeScopeCursorNoteIds } from '@/lib/practice/score-view/cursor-scope';

export function createShareVideoSessionFromCompletion(
  completion: Readonly<{
    result: Readonly<{ localSessionId: string; scoreId: string; revisionId: string; artifactId: string;
      scope: ResolvedPracticeScope; tempoPlan: ResolvedPracticeTempoPlan }>;
    recording: PerformanceRecording;
  }>,
  artifact: PracticeScoreArtifact
): ShareVideoSession {
  const { result, recording } = completion;
  if (recording.status !== 'READY' || recording.kind !== 'VIDEO') {
    throw new Error('Share video requires a ready video recording.');
  }
  if (
    artifact.scoreId !== result.scoreId ||
    artifact.revisionId !== result.revisionId ||
    artifact.artifactId !== result.artifactId
  ) {
    throw new Error('Share video score artifact identity mismatch.');
  }
  const scope = cursorScopeFromResolvedPracticeScope(
    result.scope,
    resolvePracticeScopeCursorNoteIds(artifact, result.scope)
  );
  return {
    sourceId: result.localSessionId,
    scoreIdentity: {
      scoreId: result.scoreId,
      revisionId: result.revisionId,
      artifactId: result.artifactId,
    },
    video: { status: 'READY', kind: 'VIDEO', blob: recording.blob,
      mimeType: recording.mimeType, durationMs: recording.durationMs },
    scope,
    tempoPlan: result.tempoPlan,
    recordingTimebase: recording.timebase,
  };
}
