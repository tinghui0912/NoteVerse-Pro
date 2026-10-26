'use client';

import { useCallback, useMemo, useState } from 'react';
import type { ExpectedPracticeGroup } from '@/lib/practice/kernel/artifact';
import {
  fullPiecePracticeRangeSelection,
  groupById,
  groupForRenderNoteId,
  practiceGroupsInRangeSelection,
  practiceScopeFromRangeSelection,
  transitionPracticeRangeSelection,
  type PracticeRangeSelection,
} from '@/lib/practice/score-view/range-selection';

type SelectionPhase = 'idle' | 'selecting-start' | 'selecting-end' | 'selected';

export function usePracticeRangeSelection(expectedGroups: readonly ExpectedPracticeGroup[]) {
  const [selection, setSelection] = useState<PracticeRangeSelection>(
    fullPiecePracticeRangeSelection
  );
  const [isSelecting, setIsSelecting] = useState(false);
  const hasCompletedRange = selection.kind === 'RANGE';
  const isIncomplete = selection.kind === 'SELECTING_END';

  const scopeResolution = useMemo(
    () => practiceScopeFromRangeSelection(selection, expectedGroups),
    [expectedGroups, selection]
  );
  const practiceScope = scopeResolution.status === 'ready' ? scopeResolution.scope : null;
  const selectedGroups = useMemo(
    () => practiceGroupsInRangeSelection(selection, expectedGroups),
    [expectedGroups, selection]
  );
  const selectedRangeRenderNoteIds = useMemo(() => {
    if (selection.kind === 'SELECTING_END') {
      return groupById(expectedGroups, selection.startGroupId)?.renderNoteIds ?? [];
    }
    return selectedGroups.flatMap(group => group.renderNoteIds);
  }, [expectedGroups, selection, selectedGroups]);
  const selectedMeasureRange = useMemo(
    () => selectedGroups.length > 0 ? {
      start: selectedGroups[0]?.measureNumbers[0],
      end: selectedGroups.at(-1)?.measureNumbers.at(-1),
    } : null,
    [selectedGroups]
  );

  const beginSelection = useCallback(() => {
    setIsSelecting(true);
    setSelection(fullPiecePracticeRangeSelection);
  }, []);

  const toggleSelection = useCallback(() => {
    if (hasCompletedRange || isSelecting) {
      setIsSelecting(false);
      setSelection(fullPiecePracticeRangeSelection);
    } else {
      beginSelection();
    }
  }, [beginSelection, hasCompletedRange, isSelecting]);

  const selectRenderNote = useCallback((renderNoteId: string) => {
    if (!isSelecting) return;
    const targetGroup = groupForRenderNoteId(expectedGroups, renderNoteId);
    if (!targetGroup) return;
    const { nextSelection, completed } = transitionPracticeRangeSelection(
      selection,
      expectedGroups,
      targetGroup.groupId
    );
    setSelection(nextSelection);
    if (completed) setIsSelecting(false);
  }, [expectedGroups, isSelecting, selection]);

  const phase: SelectionPhase = isSelecting
    ? isIncomplete ? 'selecting-end' : 'selecting-start'
    : hasCompletedRange ? 'selected' : 'idle';

  return {
    phase,
    isSelecting,
    isIncomplete,
    practiceScope,
    isRangeScopeReady: practiceScope?.kind === 'RANGE',
    rangeSelectionActive: isSelecting || hasCompletedRange,
    hasRangeSelection: isIncomplete || hasCompletedRange,
    selectedRangeRenderNoteIds,
    selectedMeasureRange,
    toggleSelection,
    selectRenderNote,
    beginSelection,
  };
}
