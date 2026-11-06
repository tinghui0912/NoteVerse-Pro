import { releaseLocalMediaAsset } from '@/lib/practice/media/local-media-asset';
import type { ContinuousPracticeCompletion } from '@/lib/practice/continuous/completion';
import type { AdmittedPracticeBundle } from '@/lib/practice/bundle/admitted-practice-bundle';
import { assertPerformanceRecording } from '@/lib/practice/recording/recording-artifact';

export type TransientReviewSession = Readonly<
  ContinuousPracticeCompletion & Pick<AdmittedPracticeBundle, 'musicXml'>
>;

/** Validates the handoff without copying admitted notation, artifact, result or media bytes. */
export function createTransientReviewSession(
  completion: ContinuousPracticeCompletion,
  bundle: AdmittedPracticeBundle,
): TransientReviewSession {
  assertPerformanceRecording(completion.recording);
  const { result } = completion;
  const executed = result.executed.bundle;
  const artifact = executed.artifact;
  if (
    artifact !== bundle.artifact ||
    !bundle.binding.bundleId ||
    executed.binding.bundleId !== bundle.binding.bundleId ||
    executed.binding.scoreId !== bundle.binding.scoreId ||
    executed.binding.revisionId !== bundle.binding.revisionId ||
    artifact.artifactId !== bundle.artifact.artifactId ||
    typeof bundle.musicXml !== 'string' ||
    !bundle.musicXml.trim()
  ) {
    throw new Error('Transient Review bundle identity or notation invalid.');
  }
  const recording =
    completion.recording.status === 'READY'
      ? Object.freeze({
          ...completion.recording,
          media: completion.recording.media.retain(),
        })
      : completion.recording;
  return Object.freeze({
    result,
    recording,
    musicXml: bundle.musicXml,
  });
}

export async function releaseTransientReviewSession(
  session: TransientReviewSession | null,
): Promise<void> {
  if (session?.recording.status === 'READY')
    await releaseLocalMediaAsset(session.recording.media);
}
