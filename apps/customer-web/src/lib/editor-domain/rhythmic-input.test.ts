import { describe, expect, it } from 'vitest';

import {
  createActiveVoice,
  createCaret,
  createCaretAtNearestGridPosition,
  createCaretInsertionAnchor,
  createInputDuration,
  createRhythmicGridResolution,
  createTimelineGapInsertionAnchor,
  enumerateGridPositions,
  moveCaretByGridSteps,
  snapOffsetToGrid,
} from './rhythmic-input';
import type {
  MeasureId,
  Rational,
  RhythmicValue,
  StaffId,
  VoiceId,
} from './model';

const measureId = 'measure-1' as MeasureId;
const staffId = 'staff-1' as StaffId;
const voiceId = 'voice-2' as VoiceId;
const activeVoice = createActiveVoice({ staffId, voiceId });
const wholeMeasure: Rational = { numerator: 4, denominator: 1 };
const sixteenth = createRhythmicGridResolution({ numerator: 1, denominator: 4 });

const quarterRhythm: RhythmicValue = {
  timelineDuration: { numerator: 1, denominator: 1 },
  notation: {
    base: 'quarter',
    dots: 0,
  },
};

describe('rhythmic input model', () => {
  it('keeps active voice independent from MusicXML cursor state', () => {
    expect(activeVoice).toEqual({
      staffId,
      voiceId,
    });
  });

  it('keeps input duration independent from grid resolution', () => {
    const inputDuration = createInputDuration(quarterRhythm);
    const grid = createRhythmicGridResolution({ numerator: 1, denominator: 4 });

    expect(inputDuration.rhythm.timelineDuration).toEqual({ numerator: 1, denominator: 1 });
    expect(inputDuration.rhythm.notation.base).toBe('quarter');
    expect(grid.step).toEqual({ numerator: 1, denominator: 4 });
  });

  it('creates a caret for a collapsed position in the active voice', () => {
    const caret = createCaret({
      activeVoice,
      measureId,
      offset: { numerator: 5, denominator: 4 },
    });

    expect(caret).toEqual({
      kind: 'caret',
      staffId,
      voiceId,
      position: {
        measureId,
        offset: { numerator: 5, denominator: 4 },
      },
    });
  });

  it('moves the caret by grid steps without changing input duration', () => {
    const inputDuration = createInputDuration(quarterRhythm);
    const caret = createCaret({
      activeVoice,
      measureId,
      offset: { numerator: 1, denominator: 1 },
    });

    const moved = moveCaretByGridSteps({
      caret,
      grid: sixteenth,
      steps: 2,
      measureDuration: wholeMeasure,
    });

    expect(moved.position.offset).toEqual({ numerator: 3, denominator: 2 });
    expect(inputDuration.rhythm.timelineDuration).toEqual({ numerator: 1, denominator: 1 });
  });

  it('clamps caret movement to the measure boundaries', () => {
    const caret = createCaret({
      activeVoice,
      measureId,
      offset: { numerator: 15, denominator: 4 },
    });

    expect(moveCaretByGridSteps({
      caret,
      grid: sixteenth,
      steps: 4,
      measureDuration: wholeMeasure,
    }).position.offset).toEqual(wholeMeasure);

    expect(moveCaretByGridSteps({
      caret,
      grid: sixteenth,
      steps: -99,
      measureDuration: wholeMeasure,
    }).position.offset).toEqual({ numerator: 0, denominator: 1 });
  });

  it('enumerates legal rhythmic positions for an empty voice without event anchors', () => {
    const positions = enumerateGridPositions({
      measureId,
      measureDuration: wholeMeasure,
      grid: sixteenth,
    });

    expect(positions).toHaveLength(17);
    expect(positions[0]).toMatchObject({
      index: 0,
      position: {
        offset: { numerator: 0, denominator: 1 },
      },
    });
    expect(positions[5]).toMatchObject({
      index: 5,
      position: {
        offset: { numerator: 5, denominator: 4 },
      },
    });
    expect(positions[16]).toMatchObject({
      index: 16,
      position: {
        offset: wholeMeasure,
      },
    });
  });

  it('includes the measure end as a legal caret boundary even when the grid does not divide the measure exactly', () => {
    const quarterGrid = createRhythmicGridResolution({ numerator: 1, denominator: 1 });
    const sevenEighthMeasure: Rational = { numerator: 7, denominator: 2 };

    const positions = enumerateGridPositions({
      measureId,
      measureDuration: sevenEighthMeasure,
      grid: quarterGrid,
    });

    expect(positions.map((position) => position.position.offset)).toEqual([
      { numerator: 0, denominator: 1 },
      { numerator: 1, denominator: 1 },
      { numerator: 2, denominator: 1 },
      { numerator: 3, denominator: 1 },
      { numerator: 7, denominator: 2 },
    ]);
  });

  it('snaps raw rhythmic offsets to the nearest grid position with deterministic forward ties', () => {
    expect(snapOffsetToGrid({
      measureId,
      measureDuration: wholeMeasure,
      grid: sixteenth,
      offset: { numerator: 6, denominator: 5 },
    })).toMatchObject({
      index: 5,
      position: {
        offset: { numerator: 5, denominator: 4 },
      },
    });

    expect(snapOffsetToGrid({
      measureId,
      measureDuration: wholeMeasure,
      grid: createRhythmicGridResolution({ numerator: 1, denominator: 1 }),
      offset: { numerator: 3, denominator: 2 },
    })).toMatchObject({
      index: 2,
      position: {
        offset: { numerator: 2, denominator: 1 },
      },
    });
  });

  it('creates a snapped caret without requiring rendered event or space anchors', () => {
    const { caret, gridPosition } = createCaretAtNearestGridPosition({
      activeVoice,
      measureId,
      measureDuration: wholeMeasure,
      grid: sixteenth,
      offset: { numerator: 11, denominator: 10 },
    });

    expect(gridPosition).toMatchObject({
      index: 4,
      position: {
        offset: { numerator: 1, denominator: 1 },
      },
    });
    expect(caret).toEqual({
      kind: 'caret',
      staffId,
      voiceId,
      position: {
        measureId,
        offset: { numerator: 1, denominator: 1 },
      },
    });
  });

  it('clamps snapped offsets to measure boundaries', () => {
    expect(snapOffsetToGrid({
      measureId,
      measureDuration: wholeMeasure,
      grid: sixteenth,
      offset: { numerator: -1, denominator: 1 },
    }).position.offset).toEqual({ numerator: 0, denominator: 1 });

    expect(snapOffsetToGrid({
      measureId,
      measureDuration: wholeMeasure,
      grid: sixteenth,
      offset: { numerator: 9, denominator: 1 },
    }).position.offset).toEqual(wholeMeasure);
  });

  it('creates insertion anchors from caret and timeline-gap positions', () => {
    const caret = createCaret({
      activeVoice,
      measureId,
      offset: { numerator: 2, denominator: 1 },
    });
    expect(createCaretInsertionAnchor(caret)).toEqual({
      kind: 'caret',
      caret,
    });

    const gapAnchor = createTimelineGapInsertionAnchor({
      activeVoice,
      position: {
        measureId,
        offset: { numerator: 5, denominator: 4 },
      },
      gapStart: {
        measureId,
        offset: { numerator: 1, denominator: 1 },
      },
      gapDuration: { numerator: 1, denominator: 1 },
    });

    expect(gapAnchor).toMatchObject({
      kind: 'timelineGap',
      staffId,
      voiceId,
      position: {
        offset: { numerator: 5, denominator: 4 },
      },
    });
  });

  it('rejects invalid grid, duration, caret, and gap positions', () => {
    expect(() => createRhythmicGridResolution({ numerator: 0, denominator: 1 }))
      .toThrow('Rhythmic grid step must be positive.');
    expect(() => createInputDuration({
      ...quarterRhythm,
      timelineDuration: { numerator: 0, denominator: 1 },
    })).toThrow('Input duration must be positive.');
    expect(() => createCaret({
      activeVoice,
      measureId,
      offset: { numerator: -1, denominator: 1 },
    })).toThrow('Caret offset must be non-negative.');
    expect(() => createTimelineGapInsertionAnchor({
      activeVoice,
      position: {
        measureId,
        offset: { numerator: 3, denominator: 1 },
      },
      gapStart: {
        measureId,
        offset: { numerator: 1, denominator: 1 },
      },
      gapDuration: { numerator: 1, denominator: 1 },
    })).toThrow('Insertion position must be inside the timeline gap.');
  });
});
