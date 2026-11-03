import { releaseRecordingMedia } from '@/lib/practice/recording/recording-media-resource';
import type { ContinuousPracticeCompletion } from '@/lib/practice/continuous/completion';
import type { AdmittedPracticeSource } from '@/lib/practice/source/admitted-practice-source';
import { assertContinuousPerformanceResult } from '@/lib/practice/result/continuous-performance-result';
import { assertPerformanceRecording } from '@/lib/practice/recording/recording-artifact';

export type TransientReviewSession = Readonly<ContinuousPracticeCompletion &
  Pick<AdmittedPracticeSource, 'artifact' | 'musicXml'>>;

/** Validates the handoff without copying admitted notation, artifact, result or media bytes. */
export function createTransientReviewSession(completion: ContinuousPracticeCompletion, source: AdmittedPracticeSource): TransientReviewSession {
  assertContinuousPerformanceResult(completion.result);
  assertPerformanceRecording(completion.recording);
  const { result } = completion;
  if (!source.sourceId || result.sourceId !== source.sourceId
    || result.scoreId !== source.artifact.scoreId || result.revisionId !== source.artifact.revisionId
    || result.artifactId !== source.artifact.artifactId || typeof source.musicXml !== 'string' || !source.musicXml.trim()) {
    throw new Error('Transient Review source identity or notation invalid.');
  }
  const recording = completion.recording.status === 'READY'
    ? Object.freeze({ ...completion.recording, resource: completion.recording.resource.retain() }) : completion.recording;
  return Object.freeze({ result, recording, artifact: source.artifact, musicXml: source.musicXml });
}

export async function releaseTransientReviewSession(session: TransientReviewSession | null): Promise<void> {
  if (session?.recording.status === 'READY') await releaseRecordingMedia(session.recording.resource);
}
