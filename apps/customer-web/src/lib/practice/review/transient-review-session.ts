import { releaseLocalMediaAsset } from "@/lib/practice/media/local-media-asset";
import type { ContinuousPracticeCompletion } from "@/lib/practice/continuous/completion";
import type { AdmittedPracticeSource } from "@/lib/practice/source/admitted-practice-source";
import { assertPerformanceRecording } from "@/lib/practice/recording/recording-artifact";

export type TransientReviewSession = Readonly<
  ContinuousPracticeCompletion & Pick<AdmittedPracticeSource, "musicXml">
>;

/** Validates the handoff without copying admitted notation, artifact, result or media bytes. */
export function createTransientReviewSession(
  completion: ContinuousPracticeCompletion,
  source: AdmittedPracticeSource,
): TransientReviewSession {
  assertPerformanceRecording(completion.recording);
  const { result } = completion;
  const executed = result.session.plan.source;
  const artifact = executed.artifact;
  if (
    artifact !== source.artifact ||
    !source.sourceId ||
    executed.sourceId !== source.sourceId ||
    artifact.scoreId !== source.artifact.scoreId ||
    artifact.revisionId !== source.artifact.revisionId ||
    artifact.artifactId !== source.artifact.artifactId ||
    typeof source.musicXml !== "string" ||
    !source.musicXml.trim()
  ) {
    throw new Error("Transient Review source identity or notation invalid.");
  }
  const recording =
    completion.recording.status === "READY"
      ? Object.freeze({
          ...completion.recording,
          media: completion.recording.media.retain(),
        })
      : completion.recording;
  return Object.freeze({ result, recording, musicXml: source.musicXml });
}

export async function releaseTransientReviewSession(
  session: TransientReviewSession | null,
): Promise<void> {
  if (session?.recording.status === "READY")
    await releaseLocalMediaAsset(session.recording.media);
}
