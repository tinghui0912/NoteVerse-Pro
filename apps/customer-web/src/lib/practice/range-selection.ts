import type {
  PracticeSessionScope,
  PracticeTargetRead,
} from '@/generated/practice-api';

export type PracticeRangeSelection =
  | { kind: 'FULL_PIECE' }
  | {
      kind: 'SELECTED_RANGE';
      startGroupId: string | null;
      endGroupId: string | null;
    };

export const fullPiecePracticeRangeSelection: PracticeRangeSelection = {
  kind: 'FULL_PIECE',
};

export function selectedPracticeRangeSelection(
  startGroupId: string | null = null,
  endGroupId: string | null = null
): PracticeRangeSelection {
  return {
    kind: 'SELECTED_RANGE',
    startGroupId,
    endGroupId,
  };
}

export function selectPracticeRangeTarget(
  selection: PracticeRangeSelection,
  targets: readonly PracticeTargetRead[],
  groupId: string
): PracticeRangeSelection {
  const clickedTarget = targetByGroupId(targets, groupId);
  if (!clickedTarget) {
    return selection;
  }

  if (selection.kind === 'FULL_PIECE' || selection.endGroupId) {
    return selectedPracticeRangeSelection(clickedTarget.group_id, null);
  }

  if (!selection.startGroupId) {
    return selectedPracticeRangeSelection(clickedTarget.group_id, null);
  }

  const startTarget = targetByGroupId(targets, selection.startGroupId);
  if (!startTarget) {
    return selectedPracticeRangeSelection(clickedTarget.group_id, null);
  }

  const [start, end] = orderedPracticeTargets(startTarget, clickedTarget);
  return selectedPracticeRangeSelection(start.group_id, end.group_id);
}

export function practiceScopeFromRangeSelection(
  selection: PracticeRangeSelection,
  targets: readonly PracticeTargetRead[]
): PracticeSessionScope | null {
  if (
    selection.kind === 'FULL_PIECE' ||
    !selection.startGroupId ||
    !selection.endGroupId
  ) {
    return null;
  }

  const startTarget = targetByGroupId(targets, selection.startGroupId);
  const endTarget = targetByGroupId(targets, selection.endGroupId);
  if (!startTarget || !endTarget) {
    return null;
  }

  const [start, end] = orderedPracticeTargets(startTarget, endTarget);
  return {
    start_expected_group_id: start.group_id,
    end_expected_group_id: end.group_id,
    start_measure_number: firstMeasureNumber(start),
    end_measure_number: firstMeasureNumber(end),
  };
}

export function targetForRenderNoteId(
  targets: readonly PracticeTargetRead[],
  renderNoteId: string
): PracticeTargetRead | null {
  const matches = targets
    .filter((target) => target.render_note_ids?.includes(renderNoteId))
    .sort(comparePracticeTargets);
  return matches[0] ?? null;
}

export function practiceTargetsInRangeSelection(
  selection: PracticeRangeSelection,
  targets: readonly PracticeTargetRead[]
): PracticeTargetRead[] {
  if (
    selection.kind === 'FULL_PIECE' ||
    !selection.startGroupId ||
    !selection.endGroupId
  ) {
    return [];
  }

  const startTarget = targetByGroupId(targets, selection.startGroupId);
  const endTarget = targetByGroupId(targets, selection.endGroupId);
  if (!startTarget || !endTarget) {
    return [];
  }

  const [start, end] = orderedPracticeTargets(startTarget, endTarget);
  return targets
    .filter((target) => target.index >= start.index && target.index <= end.index)
    .sort(comparePracticeTargets);
}

export function targetByGroupId(
  targets: readonly PracticeTargetRead[],
  groupId: string
): PracticeTargetRead | null {
  return targets.find((target) => target.group_id === groupId) ?? null;
}

function orderedPracticeTargets(
  first: PracticeTargetRead,
  second: PracticeTargetRead
): [PracticeTargetRead, PracticeTargetRead] {
  return comparePracticeTargets(first, second) <= 0 ? [first, second] : [second, first];
}

function comparePracticeTargets(
  first: PracticeTargetRead,
  second: PracticeTargetRead
): number {
  return first.index - second.index;
}

function firstMeasureNumber(target: PracticeTargetRead): string | null {
  return target.measure_numbers?.[0] ?? null;
}
