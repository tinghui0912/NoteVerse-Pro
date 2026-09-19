import { describe, expect, it } from 'vitest';
import type { ExpectedPracticeGroup } from './local-core/artifact';
import {
  fullPiecePracticeRangeSelection,
  practiceScopeFromRangeSelection,
  practiceGroupsInRangeSelection,
  selectPracticeRangeTarget,
  selectedPracticeRangeSelection,
  targetForRenderNoteId,
  transitionPracticeRangeSelection,
} from './range-selection';

const groups: ExpectedPracticeGroup[] = [
  {
    groupId: 'g1',
    onsetBeat: 1,
    canonicalEndBeat: 2,
    pitches: ['C4'],
    renderNoteIds: ['n1'],
    measureNumbers: ['1'],
    eventIds: ['e1'],
    expectedNotes: [],
    strikeTargets: [],
    staffIds: ['1'],
    voiceIds: ['1'],
  },
  {
    groupId: 'g2',
    onsetBeat: 2,
    canonicalEndBeat: 3,
    pitches: ['E4', 'G4'],
    renderNoteIds: ['n2', 'n3'],
    measureNumbers: ['1'],
    eventIds: ['e2', 'e3'],
    expectedNotes: [],
    strikeTargets: [],
    staffIds: ['1'],
    voiceIds: ['1'],
  },
  {
    groupId: 'g3',
    onsetBeat: 3,
    canonicalEndBeat: 4,
    pitches: ['C5'],
    renderNoteIds: ['n4'],
    measureNumbers: ['2'],
    eventIds: ['e4'],
    expectedNotes: [],
    strikeTargets: [],
    staffIds: ['1'],
    voiceIds: ['1'],
  },
];

describe('practice range selection', () => {
  it('does not create a scope for full-piece practice', () => {
    expect(
      practiceScopeFromRangeSelection(fullPiecePracticeRangeSelection, groups)
    ).toBeNull();
  });

  it('sets the first selected target as the pending start', () => {
    expect(
      selectPracticeRangeTarget(fullPiecePracticeRangeSelection, groups, 'g2')
    ).toEqual({
      kind: 'SELECTED_RANGE',
      startGroupId: 'g2',
      endGroupId: null,
    });
  });

  it('does not create a scope until both range boundaries are selected', () => {
    expect(
      practiceScopeFromRangeSelection(selectedPracticeRangeSelection('g2'), groups)
    ).toBeNull();
  });

  it('creates an inclusive scope after the end target is selected', () => {
    const selection = selectPracticeRangeTarget(
      selectedPracticeRangeSelection('g1'),
      groups,
      'g3'
    );

    expect(practiceScopeFromRangeSelection(selection, groups)).toEqual({
      startGroupId: 'g1',
      endGroupId: 'g3',
    });
  });

  it('normalizes reverse selections by target catalog index', () => {
    const selection = selectPracticeRangeTarget(
      selectedPracticeRangeSelection('g3'),
      groups,
      'g1'
    );

    expect(practiceScopeFromRangeSelection(selection, groups)).toEqual({
      startGroupId: 'g1',
      endGroupId: 'g3',
    });
  });

  it('allows a single-target range', () => {
    const selection = selectPracticeRangeTarget(
      selectedPracticeRangeSelection('g2'),
      groups,
      'g2'
    );

    expect(practiceScopeFromRangeSelection(selection, groups)).toEqual({
      startGroupId: 'g2',
      endGroupId: 'g2',
    });
  });

  it('starts a new pending selection when selecting after a complete range', () => {
    const selection = selectPracticeRangeTarget(
      selectedPracticeRangeSelection('g1', 'g3'),
      groups,
      'g2'
    );

    expect(selection).toEqual({
      kind: 'SELECTED_RANGE',
      startGroupId: 'g2',
      endGroupId: null,
    });
  });

  it('maps any rendered chord note back to the practice group', () => {
    expect(targetForRenderNoteId(groups, 'n3')?.groupId).toBe('g2');
  });

  it('returns every group inside the selected inclusive range', () => {
    expect(
      practiceGroupsInRangeSelection(
        selectedPracticeRangeSelection('g3', 'g1'),
        groups
      ).map((group) => group.groupId)
    ).toEqual(['g1', 'g2', 'g3']);
  });

  it('ignores unknown group ids', () => {
    const selection = selectedPracticeRangeSelection('g1');

    expect(selectPracticeRangeTarget(selection, groups, 'missing')).toBe(selection);
    expect(
      practiceScopeFromRangeSelection(
        selectedPracticeRangeSelection('g1', 'missing'),
        groups
      )
    ).toBeNull();
  });

  it('handles two-stage transitionPracticeRangeSelection and reports completion', () => {
    // Step 1: from FULL_PIECE to first click
    const step1 = transitionPracticeRangeSelection(
      fullPiecePracticeRangeSelection,
      groups,
      'g1'
    );
    expect(step1.completed).toBe(false);
    expect(step1.nextSelection).toEqual({
      kind: 'SELECTED_RANGE',
      startGroupId: 'g1',
      endGroupId: null,
    });

    // Step 2: from first note to second note -> completed
    const step2 = transitionPracticeRangeSelection(
      step1.nextSelection,
      groups,
      'g3'
    );
    expect(step2.completed).toBe(true);
    expect(step2.nextSelection).toEqual({
      kind: 'SELECTED_RANGE',
      startGroupId: 'g1',
      endGroupId: 'g3',
    });

    // Step 3: clicking again when already completed resets to new start note
    const step3 = transitionPracticeRangeSelection(
      step2.nextSelection,
      groups,
      'g2'
    );
    expect(step3.completed).toBe(false);
    expect(step3.nextSelection).toEqual({
      kind: 'SELECTED_RANGE',
      startGroupId: 'g2',
      endGroupId: null,
    });
  });
});

