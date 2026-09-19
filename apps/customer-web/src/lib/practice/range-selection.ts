import type { ExpectedPracticeGroup, PracticeScope } from './local-core/artifact';

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

export function groupById(
  groups: readonly ExpectedPracticeGroup[],
  groupId: string
): ExpectedPracticeGroup | null {
  return groups.find((group) => group.groupId === groupId) ?? null;
}

export const targetByGroupId = groupById;

export function groupForRenderNoteId(
  groups: readonly ExpectedPracticeGroup[],
  renderNoteId: string
): ExpectedPracticeGroup | null {
  return groups.find((group) => group.renderNoteIds.includes(renderNoteId)) ?? null;
}

export const targetForRenderNoteId = groupForRenderNoteId;

export function selectPracticeRangeTarget(
  selection: PracticeRangeSelection,
  groups: readonly ExpectedPracticeGroup[],
  groupId: string
): PracticeRangeSelection {
  const clickedGroup = groupById(groups, groupId);
  if (!clickedGroup) {
    return selection;
  }

  if (selection.kind === 'FULL_PIECE' || selection.endGroupId) {
    return selectedPracticeRangeSelection(clickedGroup.groupId, null);
  }

  if (!selection.startGroupId) {
    return selectedPracticeRangeSelection(clickedGroup.groupId, null);
  }

  const startGroup = groupById(groups, selection.startGroupId);
  if (!startGroup) {
    return selectedPracticeRangeSelection(clickedGroup.groupId, null);
  }

  const [start, end] = orderedPracticeGroups(startGroup, clickedGroup, groups);
  return selectedPracticeRangeSelection(start.groupId, end.groupId);
}

export function transitionPracticeRangeSelection(
  current: PracticeRangeSelection,
  expectedGroups: readonly ExpectedPracticeGroup[],
  targetGroupId: string
): { nextSelection: PracticeRangeSelection; completed: boolean } {
  const baseSelection =
    current.kind === 'SELECTED_RANGE' && current.startGroupId && current.endGroupId
      ? selectedPracticeRangeSelection()
      : current;
  const nextSelection = selectPracticeRangeTarget(
    baseSelection,
    expectedGroups,
    targetGroupId
  );
  const completed =
    nextSelection.kind === 'SELECTED_RANGE' &&
    Boolean(nextSelection.startGroupId && nextSelection.endGroupId);
  return { nextSelection, completed };
}

export function practiceScopeFromRangeSelection(
  selection: PracticeRangeSelection,
  groups: readonly ExpectedPracticeGroup[]
): PracticeScope | null {
  if (
    selection.kind === 'FULL_PIECE' ||
    !selection.startGroupId ||
    !selection.endGroupId
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
    !selection.startGroupId ||
    !selection.endGroupId
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

export const practiceTargetsInRangeSelection = practiceGroupsInRangeSelection;

function orderedPracticeGroups(
  first: ExpectedPracticeGroup,
  second: ExpectedPracticeGroup,
  groups: readonly ExpectedPracticeGroup[]
): [ExpectedPracticeGroup, ExpectedPracticeGroup] {
  const firstIndex = groups.indexOf(first);
  const secondIndex = groups.indexOf(second);
  return firstIndex <= secondIndex ? [first, second] : [second, first];
}
