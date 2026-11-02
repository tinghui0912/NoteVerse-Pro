import type { PracticeSourceRead } from '@/generated/api/types.gen';
import type { ApiResponse } from '@/lib/api-client';
import { SourceFailure } from '@/lib/practice/failure/causal-failure';
import { parsePracticeScoreArtifact, PracticeScoreContractError } from '@/lib/practice/kernel/artifact';
import type { AdmittedPracticeSource } from './admitted-practice-source';

type ExpectedSource = { scoreId: string; revisionId: string } & (
  | { kind: 'REVISION' }
  | { kind: 'EXACT'; sourceId: string; artifactId: string }
);

/** Shared strict envelope boundary for Setup admission and optional currently authorized export reads. */
export async function readPracticeSource(
  request: (signal: AbortSignal) => Promise<ApiResponse<PracticeSourceRead>>,
  identity: ExpectedSource,
  signal: AbortSignal,
): Promise<AdmittedPracticeSource> {
  try {
    signal.throwIfAborted();
    const { data: value } = await request(signal);
    signal.throwIfAborted();
    if (!value || typeof value.source_id !== 'string' || !value.source_id
      || identity.kind === 'EXACT' && (!identity.sourceId || value.source_id !== identity.sourceId)) {
      throw new PracticeScoreContractError('Practice source identity mismatch');
    }
    const artifact = parsePracticeScoreArtifact(value.artifact);
    if (artifact.scoreId !== identity.scoreId || artifact.revisionId !== identity.revisionId
      || identity.kind === 'EXACT' && artifact.artifactId !== identity.artifactId) {
      throw new PracticeScoreContractError('Practice source artifact identity mismatch');
    }
    if (!value.notation || value.notation.mime_type !== 'application/vnd.recordare.musicxml+xml'
      || typeof value.notation.musicxml !== 'string' || !value.notation.musicxml.trim()) {
      throw new PracticeScoreContractError('Practice source notation required');
    }
    freezeRepresentation(artifact);
    return Object.freeze({ sourceId: value.source_id, artifact, musicXml: value.notation.musicxml });
  } catch (cause) {
    signal.throwIfAborted();
    if (cause instanceof SourceFailure) throw cause;
    const invalid = cause instanceof PracticeScoreContractError || Boolean(cause && typeof cause === 'object'
      && 'code' in cause && cause.code === 'practice_score_invalid');
    throw new SourceFailure(invalid ? 'INVALID_SCORE' : 'LOAD_FAILED', { cause });
  }
}

function freezeRepresentation(value: object): void {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freezeRepresentation(child);
  Object.freeze(value);
}
