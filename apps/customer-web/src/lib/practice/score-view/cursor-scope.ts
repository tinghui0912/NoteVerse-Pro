import type { ResolvedPracticeScope } from '@/lib/practice/kernel/scope';
import { attackNoteIds, notesForIds, type PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { resolvePracticeScope, type PracticeScope } from '@/lib/practice/kernel/scope';

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

export function resolvePracticeScopeCursorNoteIds(
  artifact: PracticeScoreArtifact,
  scope: ResolvedPracticeScope | PracticeScope
): string[] {
  const resolved = 'startIndex' in scope
    ? scope
    : resolvePracticeScope(artifact, scope);
  return Array.from(
    new Set(
      artifact.moments
        .slice(resolved.startIndex, resolved.endIndex + 1)
        .flatMap(group => notesForIds(artifact, attackNoteIds(group)).map(note => note.renderNoteId))
        .filter(Boolean)
    )
  );
}
