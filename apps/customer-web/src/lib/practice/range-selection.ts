import type { ExpectedPracticeGroup, PracticeScope } from './local-core/artifact';

export type PracticeRangeSelection =
  | { kind: 'FULL_PIECE' }
  | {
      kind: 'SELECTING_END';
      startGroupId: string;
    }
  | {
      kind: 'RANGE';
      startGroupId: string;
      endGroupId: string;
    };

export const fullPiecePracticeRangeSelection: PracticeRangeSelection = {
  kind: 'FULL_PIECE',
};

export function selectedPracticeRangeSelection(
  startGroupId: string
): PracticeRangeSelection {
  return {
    kind: 'SELECTING_END',
    startGroupId,
  };
}

export function groupById(
  groups: readonly ExpectedPracticeGroup[],
  groupId: string
): ExpectedPracticeGroup | null {
  return groups.find((group) => group.groupId === groupId) ?? null;
}

export function groupForRenderNoteId(
  groups: readonly ExpectedPracticeGroup[],
  renderNoteId: string
): ExpectedPracticeGroup | null {
  return groups.find((group) => group.renderNoteIds.includes(renderNoteId)) ?? null;
}

export function selectPracticeRangeTarget(
  selection: PracticeRangeSelection,
  groups: readonly ExpectedPracticeGroup[],
  groupId: string
): PracticeRangeSelection {
  const clickedGroup = groupById(groups, groupId);
  if (!clickedGroup) {
    return selection;
  }

  if (selection.kind === 'FULL_PIECE' || selection.kind === 'RANGE') {
    return selectedPracticeRangeSelection(clickedGroup.groupId);
  }

  const startGroup = groupById(groups, selection.startGroupId);
  if (!startGroup) {
    return selectedPracticeRangeSelection(clickedGroup.groupId);
  }

  const [start, end] = orderedPracticeGroups(startGroup, clickedGroup, groups);
  return {
    kind: 'RANGE',
    startGroupId: start.groupId,
    endGroupId: end.groupId,
  };
}

export function transitionPracticeRangeSelection(
  current: PracticeRangeSelection,
  expectedGroups: readonly ExpectedPracticeGroup[],
  targetGroupId: string
): { nextSelection: PracticeRangeSelection; completed: boolean } {
  const baseSelection =
    current.kind === 'RANGE'
      ? fullPiecePracticeRangeSelection
      : current;
  const nextSelection = selectPracticeRangeTarget(
    baseSelection,
    expectedGroups,
    targetGroupId
  );
  const completed =
    nextSelection.kind === 'RANGE';
  return { nextSelection, completed };
}

export function practiceScopeFromRangeSelection(
  selection: PracticeRangeSelection,
  groups: readonly ExpectedPracticeGroup[]
): PracticeScope | null {
  if (
    selection.kind === 'FULL_PIECE' ||
    selection.kind === 'SELECTING_END'
  ) {
    return null;
  }

  const startGroup = groupById(groups, selection.startGroupId);
  const endGroup = groupById(groups, selection.endGroupId);
  if (!startGroup || !endGroup) {
    return null;
  }

  const [start, end] = orderedPracticeGroups(startGroup, endGroup, groups);
  return {
    kind: 'RANGE',
    startGroupId: start.groupId,
    endGroupId: end.groupId,
  };
}

export function practiceGroupsInRangeSelection(
  selection: PracticeRangeSelection,
  groups: readonly ExpectedPracticeGroup[]
): ExpectedPracticeGroup[] {
  if (
    selection.kind === 'FULL_PIECE' ||
    selection.kind === 'SELECTING_END'
  ) {
    return [];
  }

  const startGroup = groupById(groups, selection.startGroupId);
  const endGroup = groupById(groups, selection.endGroupId);
  if (!startGroup || !endGroup) {
    return [];
  }

  const [start, end] = orderedPracticeGroups(startGroup, endGroup, groups);
  const startIndex = groups.indexOf(start);
  const endIndex = groups.indexOf(end);
  if (startIndex === -1 || endIndex === -1) {
    return [];
  }
  return groups.slice(startIndex, endIndex + 1);
}

function orderedPracticeGroups(
  first: ExpectedPracticeGroup,
  second: ExpectedPracticeGroup,
  groups: readonly ExpectedPracticeGroup[]
): [ExpectedPracticeGroup, ExpectedPracticeGroup] {
  const firstIndex = groups.indexOf(first);
  const secondIndex = groups.indexOf(second);
  return firstIndex <= secondIndex ? [first, second] : [second, first];
}
