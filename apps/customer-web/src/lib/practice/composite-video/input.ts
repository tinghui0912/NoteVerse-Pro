import type { RecordedPerformance } from "@/lib/practice/recording/recorded-performance";
import { assertPerformanceRecording } from "@/lib/practice/recording/recording-artifact";
import { decodePracticeScoreArtifact } from "@/lib/practice/contracts/generated/score-artifact";

/** Borrows admitted execution/recording and canonical notation; acquires no media. */
export type CompositeVideoInput = Readonly<{
  recordedPerformance: RecordedPerformance;
  musicXml: string;
}>;

export function compositeVideoInput(
  recordedPerformance: RecordedPerformance,
  musicXml: string,
): CompositeVideoInput {
  assertPerformanceRecording(recordedPerformance.recording);
  if (recordedPerformance.recording.status !== "READY")
    throw new Error("composite_video_unavailable:recording_not_ready");
  if (typeof musicXml !== "string" || !musicXml.trim())
    throw new Error("composite_video_unavailable:score_not_ready");
  const { binding, artifact } = recordedPerformance.executed.bundle;
  if (
    ![binding.scoreId, binding.revisionId, binding.bundleId].every(
      (value) => typeof value === "string" && value.length > 0,
    )
  )
    throw new Error("composite_video_unavailable:bundle_identity");
  decodePracticeScoreArtifact(artifact);
  return Object.freeze({ recordedPerformance, musicXml });
}
