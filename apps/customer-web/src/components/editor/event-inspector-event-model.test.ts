import { it, expect } from 'vitest';
import { createDefaultEditableEvent, addPitch } from './event-inspector-editable-event';
import {
  getFingeringOnlyPitchedEdit,
  getPitchOnlyPitchedEdit,
  getAccidentalOnlyPitchedEdit,
  isRhythmOrStemOnlyPitchedEdit,
  updatePitchPart,
} from './event-inspector-event-model';
it('distinguishes individual draft intent without reconstructing a score model', () => {
  const current = addPitch(createDefaultEditableEvent(), 'C4');
  expect(getFingeringOnlyPitchedEdit(current, { ...current, fingerings: ['2'] })).toEqual({
    index: 0,
    value: '2',
  });
  expect(getPitchOnlyPitchedEdit(current, { ...current, pitches: ['D5'] })).toMatchObject({
    pitch: { step: 'D', octave: 5 },
  });
  expect(
    getAccidentalOnlyPitchedEdit(current, { ...current, pitches: ['C#4'], accidentals: ['sharp'] }),
  ).toMatchObject({ accidental: 'sharp', pitch: { step: 'C', octave: 4, alter: 1 } });
  expect(isRhythmOrStemOnlyPitchedEdit(current, { ...current, duration: 'durationHalf' })).toBe(
    true,
  );
  expect(updatePitchPart('F#4', 'octave', '5')).toBe('F#5');
});
