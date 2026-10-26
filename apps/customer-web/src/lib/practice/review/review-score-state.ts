import type { ContinuousPerformanceResult } from '@/lib/practice/result/continuous-performance-result';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { resolvePracticeScopeCursorNoteIds, type CursorScope } from '@/lib/practice/score-view/cursor-scope';

export type ReviewScoreState =
  | { status: 'READY'; scope: CursorScope }
  | { status: 'SOURCE_UNAVAILABLE' | 'IDENTITY_MISMATCH' | 'SCOPE_INVALID'; reason: string };

export function resolveReviewScoreState({ result, artifact, xmlAvailable, scoreId }: {
  result: ContinuousPerformanceResult | null; artifact: PracticeScoreArtifact | null;
  xmlAvailable: boolean; scoreId: string;
}): ReviewScoreState {
  if (result && artifact && (result.scoreId !== scoreId || artifact.scoreId !== result.scoreId
    || artifact.revisionId !== result.revisionId || artifact.artifactId !== result.artifactId)) {
    return { status: 'IDENTITY_MISMATCH', reason: 'score_identity_mismatch' };
  }
  if (!result || !artifact || !xmlAvailable) return { status: 'SOURCE_UNAVAILABLE', reason: 'score_source_unavailable' };
  try {
    if (result.scope.kind === 'FULL') return { status: 'READY', scope: {
      kind: 'FULL', startBeat: result.scope.startBeat, terminalBeat: result.scope.terminalBeat,
    } };
    const allowedNoteIds = resolvePracticeScopeCursorNoteIds(artifact, result.scope);
    if (!allowedNoteIds.length) return { status: 'SCOPE_INVALID', reason: 'range_has_no_selectable_notes' };
    return { status: 'READY', scope: { kind: 'RANGE', startBeat: result.scope.startBeat,
      terminalBeat: result.scope.terminalBeat, allowedNoteIds } };
  } catch (error) {
    return { status: 'SCOPE_INVALID', reason: error instanceof Error ? error.message : 'cursor_scope_invalid' };
  }
}
