import type { PracticeTargetRead } from '@/generated/practice-api';
import { describe, expect, it } from 'vitest';
import {
  fullPiecePracticeRangeSelection,
  practiceScopeFromRangeSelection,
  practiceTargetsInRangeSelection,
  selectPracticeRangeTarget,
  selectedPracticeRangeSelection,
  targetForRenderNoteId,
} from './range-selection';

const targets: PracticeTargetRead[] = [
  {
    index: 0,
    group_id: 'g1',
    onset_beat: 1,
    measure_numbers: ['1'],
    render_note_ids: ['n1'],
  },
  {
    index: 1,
    group_id: 'g2',
    onset_beat: 2,
    measure_numbers: ['1'],
    render_note_ids: ['n2', 'n3'],
  },
  {
    index: 2,
    group_id: 'g3',
    onset_beat: 3,
    measure_numbers: ['2'],
    render_note_ids: ['n4'],
  },
];

describe('practice range selection', () => {
  it('does not create a scope for full-piece practice', () => {
    expect(
      practiceScopeFromRangeSelection(fullPiecePracticeRangeSelection, targets)
    ).toBeNull();
  });

  it('sets the first selected target as the pending start', () => {
    expect(
      selectPracticeRangeTarget(fullPiecePracticeRangeSelection, targets, 'g2')
    ).toEqual({
      kind: 'SELECTED_RANGE',
      startGroupId: 'g2',
      endGroupId: null,
    });
  });

  it('does not create a scope until both range boundaries are selected', () => {
    expect(
      practiceScopeFromRangeSelection(selectedPracticeRangeSelection('g2'), targets)
    ).toBeNull();
  });

  it('creates an inclusive scope after the end target is selected', () => {
    const selection = selectPracticeRangeTarget(
      selectedPracticeRangeSelection('g1'),
      targets,
      'g3'
    );

    expect(practiceScopeFromRangeSelection(selection, targets)).toEqual({
      start_expected_group_id: 'g1',
      end_expected_group_id: 'g3',
      start_measure_number: '1',
      end_measure_number: '2',
    });
  });

  it('normalizes reverse selections by target catalog index', () => {
    const selection = selectPracticeRangeTarget(
      selectedPracticeRangeSelection('g3'),
      targets,
      'g1'
    );

    expect(practiceScopeFromRangeSelection(selection, targets)).toEqual({
      start_expected_group_id: 'g1',
      end_expected_group_id: 'g3',
      start_measure_number: '1',
      end_measure_number: '2',
    });
  });

  it('allows a single-target range', () => {
    const selection = selectPracticeRangeTarget(
      selectedPracticeRangeSelection('g2'),
      targets,
      'g2'
    );

    expect(practiceScopeFromRangeSelection(selection, targets)).toEqual({
      start_expected_group_id: 'g2',
      end_expected_group_id: 'g2',
      start_measure_number: '1',
      end_measure_number: '1',
    });
  });

  it('starts a new pending selection when selecting after a complete range', () => {
    const selection = selectPracticeRangeTarget(
      selectedPracticeRangeSelection('g1', 'g3'),
      targets,
      'g2'
    );

    expect(selection).toEqual({
      kind: 'SELECTED_RANGE',
      startGroupId: 'g2',
      endGroupId: null,
    });
  });

  it('maps any rendered chord note back to the backend target', () => {
    expect(targetForRenderNoteId(targets, 'n3')?.group_id).toBe('g2');
  });

  it('returns every catalog target inside the selected inclusive range', () => {
    expect(
      practiceTargetsInRangeSelection(
        selectedPracticeRangeSelection('g3', 'g1'),
        targets
      ).map((target) => target.group_id)
    ).toEqual(['g1', 'g2', 'g3']);
  });

  it('ignores unknown group ids', () => {
    const selection = selectedPracticeRangeSelection('g1');

    expect(selectPracticeRangeTarget(selection, targets, 'missing')).toBe(selection);
    expect(
      practiceScopeFromRangeSelection(
        selectedPracticeRangeSelection('g1', 'missing'),
        targets
      )
    ).toBeNull();
  });
});
