import type { TransientReviewSession } from '@/lib/practice/review/transient-review-session';
import type { ShareVideoSession } from './session';
import { cursorScopeFromResolvedPracticeScope, resolvePracticeScopeCursorNoteIds } from '@/lib/practice/score-view/cursor-scope';

export function createShareVideoSessionFromCompletion(session: TransientReviewSession): ShareVideoSession {
  const { result, recording, artifact } = session;
  if (recording.status !== 'READY' || recording.kind !== 'VIDEO') {
    throw new Error('Share video requires a ready video recording.');
  }
  const scope = cursorScopeFromResolvedPracticeScope(
    result.scope,
    resolvePracticeScopeCursorNoteIds(artifact, result.scope)
  );
  return {
    sessionId: result.localSessionId,
    sourceId: result.sourceId,
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
