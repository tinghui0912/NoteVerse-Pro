import type { ResolvedPracticeScope } from './artifact';

/**
 * The renderer-facing projection of a resolved practice scope.
 * The canonical selection identity remains on ResolvedPracticeScope.
 */
export type CursorScope =
  | {
      kind: 'FULL';
      startBeat: number;
      terminalBeat: number;
    }
  | {
      kind: 'RANGE';
      startBeat: number;
      terminalBeat: number;
      allowedNoteIds: readonly string[];
    };

export function cursorScopeFromResolvedPracticeScope(
  scope: ResolvedPracticeScope,
  allowedNoteIds: readonly string[] = []
): CursorScope {
  if (scope.kind === 'FULL') {
    return {
      kind: 'FULL',
      startBeat: scope.startBeat,
      terminalBeat: scope.terminalBeat,
    };
  }
  if (allowedNoteIds.length === 0) {
    throw new Error('Range cursor scope requires allowed note IDs.');
  }
  return {
    kind: 'RANGE',
    startBeat: scope.startBeat,
    terminalBeat: scope.terminalBeat,
    allowedNoteIds,
  };
}
