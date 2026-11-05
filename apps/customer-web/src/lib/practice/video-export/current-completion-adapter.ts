import type { TransientReviewSession } from "@/lib/practice/review/transient-review-session";
import type { VideoExportSession } from "./session";
import {
  cursorScopeFromResolvedPracticeScope,
  resolvePracticeScopeCursorNoteIds,
} from "@/lib/practice/score-view/cursor-scope";

export function createVideoExportSessionFromCompletion(
  session: TransientReviewSession,
): VideoExportSession {
  const { result, recording } = session;
  const artifact = result.session.plan.source.artifact;
  if (recording.status !== "READY" || recording.kind !== "VIDEO") {
    throw new Error("Video export requires a ready video recording.");
  }
  const scope = cursorScopeFromResolvedPracticeScope(
    result.session.plan.scope,
    resolvePracticeScopeCursorNoteIds(artifact, result.session.plan.scope),
  );
  return {
    sessionId: result.session.localSessionId,
    sourceId: result.session.plan.source.sourceId,
    scoreIdentity: {
      scoreId: result.session.plan.source.artifact.scoreId,
      revisionId: result.session.plan.source.artifact.revisionId,
      artifactId: result.session.plan.source.artifact.artifactId,
    },
    video: {
      status: "READY",
      kind: "VIDEO",
      media: recording.media,
      mimeType: recording.mimeType,
      durationMs: recording.durationMs,
    },
    scope,
    tempoPlan: result.session.plan.tempoPlan,
    recordingTimebase: recording.timebase,
  };
}
