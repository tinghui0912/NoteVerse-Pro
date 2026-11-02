import type { TransientReviewSession } from './transient-review-session';
import { resolvePracticeScopeCursorNoteIds, type CursorScope } from '@/lib/practice/score-view/cursor-scope';

export type ReviewScoreState =
  | { status: 'READY'; scope: CursorScope }
  | { status: 'SCOPE_INVALID'; reason: string };

export function resolveReviewScoreState({ result, artifact }: TransientReviewSession): ReviewScoreState {
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
