// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ExpectedPracticeGroup } from '@/lib/practice/kernel/artifact';
import { usePracticeRangeSelection } from './use-practice-range-selection';

const groups: ExpectedPracticeGroup[] = [1, 2, 3].map(number => ({
  groupId: `g${number}`,
  onsetBeat: number - 1,
  canonicalEndBeat: number,
  pitches: ['C4'],
  renderNoteIds: number === 2 ? ['n2a', 'n2b'] : [`n${number}`],
  measureNumbers: [String(number)],
  eventIds: [],
  expectedNotes: [],
  strikeTargets: [],
  staffIds: ['1'],
  voiceIds: ['1'],
}));

function selectRange(
  result: { current: ReturnType<typeof usePracticeRangeSelection> },
  first = 'n1',
  second = 'n3'
) {
  act(() => result.current.toggleSelection());
  act(() => result.current.selectRenderNote(first));
  act(() => result.current.selectRenderNote(second));
}

describe('usePracticeRangeSelection', () => {
  it('starts inactive with a ready full-piece scope and no selected notes', () => {
    const { result } = renderHook(() => usePracticeRangeSelection(groups));

    expect(result.current).toMatchObject({
      phase: 'idle',
      isSelecting: false,
      isIncomplete: false,
      practiceScope: { kind: 'FULL' },
      isRangeScopeReady: false,
      rangeSelectionActive: false,
      hasRangeSelection: false,
      selectedRangeRenderNoteIds: [],
      selectedMeasureRange: null,
    });
  });

  it('enters selecting-start while preserving the ready full-piece scope', () => {
    const { result } = renderHook(() => usePracticeRangeSelection(groups));
    act(() => result.current.toggleSelection());

    expect(result.current).toMatchObject({
      phase: 'selecting-start',
      isSelecting: true,
      rangeSelectionActive: true,
      hasRangeSelection: false,
      isIncomplete: false,
      practiceScope: { kind: 'FULL' },
      selectedRangeRenderNoteIds: [],
    });
  });

  it('makes the scope incomplete and highlights the pending group on the first note', () => {
    const { result } = renderHook(() => usePracticeRangeSelection(groups));
    act(() => result.current.toggleSelection());
    act(() => result.current.selectRenderNote('n2b'));

    expect(result.current).toMatchObject({
      phase: 'selecting-end',
      isSelecting: true,
      isIncomplete: true,
      practiceScope: null,
      hasRangeSelection: true,
      isRangeScopeReady: false,
      selectedRangeRenderNoteIds: ['n2a', 'n2b'],
    });
  });

  it('completes an inclusive range and exits selection after the second note', () => {
    const { result } = renderHook(() => usePracticeRangeSelection(groups));
    selectRange(result);

    expect(result.current).toMatchObject({
      phase: 'selected',
      isSelecting: false,
      isIncomplete: false,
      practiceScope: { kind: 'RANGE', startGroupId: 'g1', endGroupId: 'g3' },
      isRangeScopeReady: true,
      rangeSelectionActive: true,
      hasRangeSelection: true,
      selectedRangeRenderNoteIds: ['n1', 'n2a', 'n2b', 'n3'],
      selectedMeasureRange: { start: '1', end: '3' },
    });
  });

  it('normalizes reverse clicks using the expected group order', () => {
    const { result } = renderHook(() => usePracticeRangeSelection(groups));
    selectRange(result, 'n3', 'n1');

    expect(result.current.practiceScope).toEqual({
      kind: 'RANGE', startGroupId: 'g1', endGroupId: 'g3',
    });
    expect(result.current.selectedRangeRenderNoteIds).toEqual(['n1', 'n2a', 'n2b', 'n3']);
    expect(result.current.selectedMeasureRange).toEqual({ start: '1', end: '3' });
  });

  it('cancels an incomplete selection back to full piece and clears its highlight', () => {
    const { result } = renderHook(() => usePracticeRangeSelection(groups));
    act(() => result.current.toggleSelection());
    act(() => result.current.selectRenderNote('n1'));
    act(() => result.current.toggleSelection());

    expect(result.current).toMatchObject({
      phase: 'idle', isSelecting: false, isIncomplete: false,
      practiceScope: { kind: 'FULL' }, rangeSelectionActive: false,
      hasRangeSelection: false, selectedRangeRenderNoteIds: [],
    });
  });

  it('clears a completed range when selection is toggled again', () => {
    const { result } = renderHook(() => usePracticeRangeSelection(groups));
    selectRange(result);
    act(() => result.current.toggleSelection());

    expect(result.current).toMatchObject({
      phase: 'idle', practiceScope: { kind: 'FULL' }, isRangeScopeReady: false,
      rangeSelectionActive: false, selectedRangeRenderNoteIds: [], selectedMeasureRange: null,
    });
  });

  it('begins a replacement selection with the completed range cleared', () => {
    const { result } = renderHook(() => usePracticeRangeSelection(groups));
    selectRange(result);
    act(() => result.current.beginSelection());

    expect(result.current).toMatchObject({
      phase: 'selecting-start', isSelecting: true, isIncomplete: false,
      practiceScope: { kind: 'FULL' }, rangeSelectionActive: true,
      selectedRangeRenderNoteIds: [], selectedMeasureRange: null,
    });
    act(() => result.current.selectRenderNote('n2a'));
    act(() => result.current.selectRenderNote('n3'));
    expect(result.current.practiceScope).toEqual({
      kind: 'RANGE', startGroupId: 'g2', endGroupId: 'g3',
    });
  });

  it('ignores unknown notes and does not change a selection when selection mode is inactive', () => {
    const { result } = renderHook(() => usePracticeRangeSelection(groups));
    act(() => result.current.selectRenderNote('n1'));
    expect(result.current.phase).toBe('idle');
    act(() => result.current.toggleSelection());
    act(() => result.current.selectRenderNote('unknown'));
    expect(result.current.phase).toBe('selecting-start');
    act(() => result.current.selectRenderNote('n1'));
    act(() => result.current.selectRenderNote('unknown'));
    expect(result.current.phase).toBe('selecting-end');
    expect(result.current.selectedRangeRenderNoteIds).toEqual(['n1']);
    act(() => result.current.selectRenderNote('n3'));
    act(() => result.current.selectRenderNote('n2a'));
    expect(result.current.practiceScope).toEqual({
      kind: 'RANGE', startGroupId: 'g1', endGroupId: 'g3',
    });
  });

  it('accepts two notes from the same group as a single-group range', () => {
    const { result } = renderHook(() => usePracticeRangeSelection(groups));
    selectRange(result, 'n2b', 'n2a');

    expect(result.current.phase).toBe('selected');
    expect(result.current.practiceScope).toEqual({
      kind: 'RANGE', startGroupId: 'g2', endGroupId: 'g2',
    });
    expect(result.current.selectedRangeRenderNoteIds).toEqual(['n2a', 'n2b']);
    expect(result.current.selectedMeasureRange).toEqual({ start: '2', end: '2' });
  });
});
