import type { ExecutedPerformance } from '@/lib/practice/run/executed-performance';
import type { ResolvedPracticeScope } from '@/lib/practice/planning/scope';
import {
  attackNoteIds,
  notesForIds,
  type PracticeScoreArtifact,
} from '@/lib/practice/score/artifact';
import {
  resolvePracticeScope,
  type PracticeScope,
} from '@/lib/practice/planning/scope';

/**
 * The renderer-facing projection of a resolved practice scope.
 * The canonical selection identity remains on ResolvedPracticeScope.
 */
export type CursorScope =
  | {
      kind: 'FULL';
      startTick: number;
      terminalTick: number;
    }
  | {
      kind: 'RANGE';
      startTick: number;
      terminalTick: number;
      allowedNoteIds: readonly string[];
    };

function cursorScopeFromResolvedPracticeScope(
  scope: ResolvedPracticeScope,
  allowedNoteIds: readonly string[] = [],
): CursorScope {
  if (scope.kind === 'FULL') {
    return {
      kind: 'FULL',
      startTick: scope.startTick,
      terminalTick: scope.terminalTick,
    };
  }
  if (allowedNoteIds.length === 0) {
    throw new Error('Range cursor scope requires allowed note IDs.');
  }
  return {
    kind: 'RANGE',
    startTick: scope.startTick,
    terminalTick: scope.terminalTick,
    allowedNoteIds,
  };
}

export function resolvePracticeScopeCursorNoteIds(
  artifact: PracticeScoreArtifact,
  scope: ResolvedPracticeScope | PracticeScope,
): string[] {
  const resolved =
    'startIndex' in scope ? scope : resolvePracticeScope(artifact, scope);
  return Array.from(
    new Set(
      artifact.moments
        .slice(resolved.startIndex, resolved.endIndex + 1)
        .flatMap((group) =>
          notesForIds(artifact, attackNoteIds(group)).map(
            (note) => note.renderNoteId,
          ),
        )
        .filter(Boolean),
    ),
  );
}

const executedScopes = new WeakMap<ExecutedPerformance, CursorScope>();
export function cursorScopeFromExecutedPerformance(
  executed: ExecutedPerformance,
): CursorScope {
  let scope = executedScopes.get(executed);
  if (!scope) {
    scope = cursorScopeFromResolvedPracticeScope(
      executed.scope,
      executed.scope.kind === 'RANGE'
        ? resolvePracticeScopeCursorNoteIds(
            executed.bundle.artifact,
            executed.scope,
          )
        : [],
    );
    executedScopes.set(executed, scope);
  }
  return scope;
}
