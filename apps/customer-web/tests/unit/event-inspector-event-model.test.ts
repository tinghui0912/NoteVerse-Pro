import { describe, expect, it } from 'vitest';
import {
  accidentalPitchSuffix,
  getEntitySummaryIcon,
  getEntitySummaryPitch,
  splitPitch,
  toEntityForSave,
  updatePitchPart,
} from '@/components/editor/event-inspector-event-model';
import type { EditableEvent } from '@/lib/editor/editable-event';
import type { Blank, Chord, Note } from '@/types/score-types';

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

  it('summarizes entity pitch text with caller-provided rest and blank labels', () => {
    const note: Note = {
      type: 'note',
      pitch: 'C4',
      duration: 'durationQuarter',
    };
    const chord: Chord = {
      type: 'chord',
      pitches: ['C4', 'E4'],
      duration: 'durationQuarter',
    };
    const blank: Blank = {
      type: 'blank',
      duration: 'durationQuarter',
    };

    expect(getEntitySummaryPitch(note, 'Rest', 'Blank')).toBe('C4');
    expect(getEntitySummaryPitch(chord, 'Rest', 'Blank')).toBe('C4 + E4');
    expect(getEntitySummaryPitch({ type: 'rest', duration: 'durationQuarter' }, 'Rest', 'Blank')).toBe('Rest');
    expect(getEntitySummaryPitch(blank, 'Rest', 'Blank')).toBe('Blank');
  });

  it('summarizes entity kinds with stable text labels', () => {
    expect(getEntitySummaryIcon({ type: 'note', pitch: 'C4', duration: 'durationQuarter' })).toBe('note');
    expect(getEntitySummaryIcon({ type: 'chord', pitches: ['C4', 'E4'], duration: 'durationQuarter' })).toBe('chord');
    expect(getEntitySummaryIcon({ type: 'rest', duration: 'durationQuarter' })).toBe('rest');
  });

  it('preserves blank entities when saving an empty editable event', () => {
    const blank: Blank = {
      type: 'blank',
      duration: 'durationHalf',
      dotted: false,
      meta: {
        id: 'blank-1',
        measureIndex: 0,
        staveIndex: 0,
        xmlVoice: 1,
        entityIndex: 2,
        startTick: 8,
      },
    };

    expect(
      toEntityForSave(blank, {
        ...baseEditableEvent,
        duration: 'durationQuarter',
        dotted: true,
      })
    ).toEqual({
      ...blank,
      duration: 'durationQuarter',
      dotted: true,
    });
  });

  it('converts non-empty editable events to score entities', () => {
    const blank: Blank = {
      type: 'blank',
      duration: 'durationQuarter',
    };

    expect(
      toEntityForSave(blank, {
        ...baseEditableEvent,
        pitches: ['G4'],
        stemDirection: 'up',
        fingerings: ['2'],
        accidentals: ['sharp'],
      })
    ).toEqual({
      type: 'note',
      pitch: 'G4',
      duration: 'durationQuarter',
      dotted: false,
      stemDirection: 'up',
      fingering: '2',
      accidental: 'sharp',
      meta: undefined,
    });
  });
});
