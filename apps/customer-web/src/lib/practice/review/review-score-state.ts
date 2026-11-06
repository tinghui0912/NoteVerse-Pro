import type { TransientReviewSession } from "./transient-review-session";
import {
  resolvePracticeScopeCursorNoteIds,
  type CursorScope,
} from "@/lib/practice/score-view/cursor-scope";

export type ReviewScoreState =
  | { status: "READY"; scope: CursorScope }
  | { status: "SCOPE_INVALID"; reason: string };

export function resolveReviewScoreState({
  result,
}: TransientReviewSession): ReviewScoreState {
  const artifact = result.session.plan.bundle.artifact;
  try {
    if (result.session.plan.scope.kind === "FULL")
      return {
        status: "READY",
        scope: {
          kind: "FULL",
          startTick: result.session.plan.scope.startTick,
          terminalTick: result.session.plan.scope.terminalTick,
        },
      };
    const allowedNoteIds = resolvePracticeScopeCursorNoteIds(
      artifact,
      result.session.plan.scope,
    );
    if (!allowedNoteIds.length)
      return {
        status: "SCOPE_INVALID",
        reason: "range_has_no_selectable_notes",
      };
    return {
      status: "READY",
      scope: {
        kind: "RANGE",
        startTick: result.session.plan.scope.startTick,
        terminalTick: result.session.plan.scope.terminalTick,
        allowedNoteIds,
      },
    };
  } catch (error) {
    return {
      status: "SCOPE_INVALID",
      reason: error instanceof Error ? error.message : "cursor_scope_invalid",
    };
  }
}
