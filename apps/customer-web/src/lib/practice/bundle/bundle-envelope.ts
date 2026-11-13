import type { PracticeScoreRevisionBundleGetResponse } from '@/generated/api';
import {
decodePracticeScoreArtifact,
PracticeScoreStructureError,
} from '@/lib/practice/contracts/generated/score-artifact';
import { BundleFailure } from '@/lib/practice/failure/causal-failure';
import type { AdmittedPracticeBundle } from './admitted-practice-bundle';

type ExpectedBundle = { scoreId: string; revisionId: string } & (
  | { kind: 'REVISION' }
  | { kind: 'EXACT'; bundleId: string; artifactId: string }
);

/** Shared strict envelope boundary for Setup admission and optional currently authorized export reads. */
export async function readPracticeBundle(
  request: (signal: AbortSignal) => Promise<PracticeScoreRevisionBundleGetResponse>,
  identity: ExpectedBundle,
  signal: AbortSignal,
): Promise<AdmittedPracticeBundle> {
  try {
    signal.throwIfAborted();
    const { data: value } = await request(signal);
    signal.throwIfAborted();
    if (
      !value ||
      !value.binding ||
      value.binding.score_id !== identity.scoreId ||
      value.binding.revision_id !== identity.revisionId ||
      typeof value.binding.bundle_id !== 'string' ||
      !value.binding.bundle_id ||
      (identity.kind === 'EXACT' &&
        (!identity.bundleId || value.binding?.bundle_id !== identity.bundleId))
    ) {
      throw new PracticeScoreStructureError('Practice bundle identity mismatch');
    }
    const artifact = decodePracticeScoreArtifact(value.artifact);
    if (
      identity.kind === 'EXACT' &&
      artifact.artifactId !== identity.artifactId
    ) {
      throw new PracticeScoreStructureError(
        'Practice bundle artifact identity mismatch',
      );
    }
    if (
      !value.notation ||
      value.notation.mime_type !== 'application/vnd.recordare.musicxml+xml' ||
      typeof value.notation.musicxml !== 'string' ||
      !value.notation.musicxml.trim()
    ) {
      throw new PracticeScoreStructureError('Practice bundle notation required');
    }
    freezeRepresentation(artifact);
    return Object.freeze({
      binding: Object.freeze({
        scoreId: value.binding.score_id,
        revisionId: value.binding.revision_id,
        bundleId: value.binding.bundle_id,
      }),
      artifact,
      musicXml: value.notation.musicxml,
    });
  } catch (cause) {
    signal.throwIfAborted();
    if (cause instanceof BundleFailure) throw cause;
    const invalid =
      cause instanceof PracticeScoreStructureError ||
      Boolean(
        cause &&
          typeof cause === 'object' &&
          'code' in cause &&
          cause.code === 'practice_score_invalid',
      );
    throw new BundleFailure(invalid ? 'INVALID_SCORE' : 'LOAD_FAILED', {
      cause,
    });
  }
}

function freezeRepresentation(value: object): void {
  for (const child of Object.values(value))
    if (child && typeof child === 'object') freezeRepresentation(child);
  Object.freeze(value);
}
