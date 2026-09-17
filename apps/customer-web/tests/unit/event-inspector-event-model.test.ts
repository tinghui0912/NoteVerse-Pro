import { describe, expect, it } from 'vitest';
import {
  accidentalPitchSuffix,
  getAccidentalOnlyPitchedEdit,
  getFingeringOnlyPitchedEdit,
  getPitchOnlyPitchedEdit,
  isRhythmOrStemOnlyPitchedEdit,
  splitPitch,
  toInspectorEditStateFromEditableEvent,
  updatePitchPart,
} from '@/components/editor/event-inspector-event-model';
import type { EditableEvent } from '@/components/editor/event-inspector-editable-event';
import type { Note, Rest } from '@/types/score-types';

const baseEditableEvent: EditableEvent = {
  duration: 'durationQuarter',
  dotted: false,
  pitches: [],
  stemDirection: 'none',
  fingerings: [],
  accidentals: [],
};

describe('event inspector event model helpers', () => {
  it('parses pitch names, accidentals, and octaves', () => {
    expect(splitPitch('F#5')).toEqual({
      name: 'F',
      accidental: '#',
      octave: '5',
    });
    expect(splitPitch('Bbb3')).toEqual({
      name: 'B',
      accidental: 'bb',
      octave: '3',
    });
  });

  it('falls back to C4 for invalid pitch text', () => {
    expect(splitPitch('not-a-pitch')).toEqual({
      name: 'C',
      accidental: '',
      octave: '4',
    });
  });

  it('updates one pitch part without rewriting the remaining parts', () => {
    expect(updatePitchPart('F#5', 'name', 'G')).toBe('G#5');
    expect(updatePitchPart('F#5', 'octave', '3')).toBe('F#3');
  });

  it('maps accidentals to MusicXML pitch suffixes', () => {
    expect(accidentalPitchSuffix('flat-flat')).toBe('bb');
    expect(accidentalPitchSuffix('flat')).toBe('b');
    expect(accidentalPitchSuffix('natural')).toBe('');
    expect(accidentalPitchSuffix('sharp')).toBe('#');
  });

  it('projects explicit rest edits as domain drafts', () => {
    const rest: Rest = {
      type: 'rest',
      duration: 'durationHalf',
      dotted: false,
      meta: {
        id: 'rest-1',
        measureIndex: 0,
        staveIndex: 0,
        xmlVoice: 1,
        entityIndex: 2,
        startTick: 8,
      },
    };
    const state = toInspectorEditStateFromEditableEvent(rest, {
      ...baseEditableEvent,
      duration: 'durationQuarter',
      dotted: true,
    });

    expect(state.draft).toMatchObject({
      kind: 'explicitRest',
      eventId: 'rest-1',
      rhythm: {
        timelineDuration: { numerator: 3, denominator: 2 },
        notation: { base: 'quarter', dots: 1 },
      },
    });
  });

  it('projects pitched editable events as domain drafts', () => {
    const rest: Rest = {
      type: 'rest',
      duration: 'durationQuarter',
    };
    const state = toInspectorEditStateFromEditableEvent(rest, {
      ...baseEditableEvent,
      pitches: ['G4'],
      stemDirection: 'up',
      fingerings: ['2'],
      accidentals: ['sharp'],
    });

    expect(state.draft).toMatchObject({
      kind: 'pitchedEvent',
      notes: [
        {
          pitch: { step: 'G', octave: 4 },
          fingering: '2',
          accidental: 'sharp',
        },
      ],
    });
    expect(state.notationOverrides.stemDirection).toBe('up');
  });

  it('keeps automatic stem engraving as a missing notation override', () => {
    const note: Note = {
      type: 'note',
      pitch: 'C4',
      duration: 'durationQuarter',
      stemDirection: 'up',
    };

    const state = toInspectorEditStateFromEditableEvent(note, {
      ...baseEditableEvent,
      pitches: ['C4'],
      stemDirection: 'none',
    });

    expect(state.notationOverrides.stemDirection).toBeUndefined();
  });

  it('classifies duration, dotted, and stem edits as the narrow domain save path', () => {
    const current: EditableEvent = {
      ...baseEditableEvent,
      pitches: ['C4', 'E4'],
      fingerings: ['1', '3'],
      accidentals: [null, 'sharp'],
    };

    expect(isRhythmOrStemOnlyPitchedEdit(current, {
      ...current,
      duration: 'durationHalf',
      dotted: true,
      stemDirection: 'down',
    })).toBe(true);
  });

  it('keeps pitch, accidental, fingering, and rest edits out of the narrow domain save path', () => {
    const current: EditableEvent = {
      ...baseEditableEvent,
      pitches: ['C4'],
      fingerings: ['1'],
      accidentals: [null],
    };

    expect(isRhythmOrStemOnlyPitchedEdit(current, {
      ...current,
      pitches: ['D4'],
    })).toBe(false);
    expect(isRhythmOrStemOnlyPitchedEdit(current, {
      ...current,
      accidentals: ['sharp'],
    })).toBe(false);
    expect(isRhythmOrStemOnlyPitchedEdit(current, {
      ...current,
      fingerings: ['2'],
    })).toBe(false);
    expect(isRhythmOrStemOnlyPitchedEdit(current, {
      ...current,
      pitches: [],
      fingerings: [],
      accidentals: [],
    })).toBe(false);
  });

  it('detects a single fingering-only pitched edit', () => {
    const current: EditableEvent = {
      ...baseEditableEvent,
      pitches: ['C4', 'E4'],
      fingerings: ['1', 'none'],
      accidentals: [null, null],
    };

    expect(getFingeringOnlyPitchedEdit(current, {
      ...current,
      fingerings: ['1', '4'],
    })).toEqual({
      index: 1,
      value: '4',
    });
  });

  it('rejects fingering migration when other fields also change', () => {
    const current: EditableEvent = {
      ...baseEditableEvent,
      pitches: ['C4', 'E4'],
      fingerings: ['1', '2'],
      accidentals: [null, null],
    };

    expect(getFingeringOnlyPitchedEdit(current, {
      ...current,
      pitches: ['D4', 'E4'],
      fingerings: ['3', '2'],
    })).toBeNull();
    expect(getFingeringOnlyPitchedEdit(current, {
      ...current,
      duration: 'durationHalf',
      fingerings: ['3', '2'],
    })).toBeNull();
    expect(getFingeringOnlyPitchedEdit(current, {
      ...current,
      fingerings: ['3', '4'],
    })).toBeNull();
  });

  it('converts a single pitch-name or octave edit into a domain pitch patch', () => {
    const current: EditableEvent = {
      ...baseEditableEvent,
      pitches: ['C4', 'E4'],
      fingerings: ['none', 'none'],
      accidentals: [null, null],
    };

    expect(getPitchOnlyPitchedEdit(current, {
      ...current,
      pitches: ['D4', 'E4'],
    })).toEqual({
      index: 0,
      pitch: { step: 'D', octave: 4 },
    });
    expect(getPitchOnlyPitchedEdit(current, {
      ...current,
      pitches: ['C4', 'E5'],
    })).toEqual({
      index: 1,
      pitch: { step: 'E', octave: 5 },
    });
  });

  it('keeps accidental button semantics out of pitch-only migration', () => {
    const current: EditableEvent = {
      ...baseEditableEvent,
      pitches: ['C4'],
      fingerings: ['none'],
      accidentals: [null],
    };

    expect(getPitchOnlyPitchedEdit(current, {
      ...current,
      pitches: ['C#4'],
      accidentals: ['sharp'],
    })).toBeNull();
  });

  it('rejects pitch-only migration when other fields or multiple pitches also change', () => {
    const current: EditableEvent = {
      ...baseEditableEvent,
      pitches: ['C4', 'E4'],
      fingerings: ['none', 'none'],
      accidentals: [null, null],
    };

    expect(getPitchOnlyPitchedEdit(current, {
      ...current,
      pitches: ['D4', 'E4'],
      duration: 'durationHalf',
    })).toBeNull();
    expect(getPitchOnlyPitchedEdit(current, {
      ...current,
      pitches: ['D4', 'F4'],
    })).toBeNull();
  });

  it('converts a single accidental UI edit into a domain pitch and accidental patch', () => {
    const current: EditableEvent = {
      ...baseEditableEvent,
      pitches: ['C4', 'E4'],
      fingerings: ['none', 'none'],
      accidentals: [null, null],
    };

    expect(getAccidentalOnlyPitchedEdit(current, {
      ...current,
      pitches: ['C#4', 'E4'],
      accidentals: ['sharp', null],
    })).toEqual({
      index: 0,
      pitch: { step: 'C', octave: 4, alter: 1 },
      accidental: 'sharp',
    });
    expect(getAccidentalOnlyPitchedEdit(current, {
      ...current,
      pitches: ['C4', 'Eb4'],
      accidentals: [null, 'flat'],
    })).toEqual({
      index: 1,
      pitch: { step: 'E', octave: 4, alter: -1 },
      accidental: 'flat',
    });
  });

  it('represents natural accidental as explicit natural with unaltered pitch', () => {
    const current: EditableEvent = {
      ...baseEditableEvent,
      pitches: ['C#4'],
      fingerings: ['none'],
      accidentals: ['sharp'],
    };

    expect(getAccidentalOnlyPitchedEdit(current, {
      ...current,
      pitches: ['C4'],
      accidentals: ['natural'],
    })).toEqual({
      index: 0,
      pitch: { step: 'C', octave: 4 },
      accidental: 'natural',
    });
  });

  it('represents clicking the active accidental again as clearing pitch alter and displayed accidental', () => {
    const current: EditableEvent = {
      ...baseEditableEvent,
      pitches: ['F#4'],
      fingerings: ['none'],
      accidentals: ['sharp'],
    };

    expect(getAccidentalOnlyPitchedEdit(current, {
      ...current,
      pitches: ['F4'],
      accidentals: [null],
    })).toEqual({
      index: 0,
      pitch: { step: 'F', octave: 4 },
      accidental: null,
    });
  });

  it('rejects accidental migration when other fields also change', () => {
    const current: EditableEvent = {
      ...baseEditableEvent,
      pitches: ['C4'],
      fingerings: ['1'],
      accidentals: [null],
    };

    expect(getAccidentalOnlyPitchedEdit(current, {
      ...current,
      pitches: ['C#4'],
      accidentals: ['sharp'],
      fingerings: ['2'],
    })).toBeNull();
    expect(getAccidentalOnlyPitchedEdit(current, {
      ...current,
      pitches: ['C#4'],
      accidentals: ['sharp'],
      duration: 'durationHalf',
    })).toBeNull();
    expect(getAccidentalOnlyPitchedEdit(current, {
      ...current,
      pitches: ['C#4', 'E4'],
      accidentals: ['sharp', null],
    })).toBeNull();
  });
});
