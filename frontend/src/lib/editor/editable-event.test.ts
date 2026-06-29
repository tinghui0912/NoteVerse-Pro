import { describe, expect, it } from 'vitest';
import type { ScoreEntity } from '@/types/score-types';
import {
  addPitch,
  createDefaultEditableEvent,
  getEditableEventKind,
  removePitch,
  toEditableEvent,
  toScoreEntity,
} from './editable-event';

describe('editable event view model', () => {
  it('infers rest, note, and chord from pitch count', () => {
    expect(getEditableEventKind({ pitches: [] })).toBe('rest');
    expect(getEditableEventKind({ pitches: ['C4'] })).toBe('note');
    expect(getEditableEventKind({ pitches: ['C4', 'E4'] })).toBe('chord');
  });

  it('uses an empty pitch array as the default insert event', () => {
    const event = createDefaultEditableEvent();

    expect(event.pitches).toEqual([]);
    expect(toScoreEntity(event).type).toBe('rest');
  });

  it('converts editable pitch counts back to score entities', () => {
    const base = createDefaultEditableEvent();

    expect(toScoreEntity(base).type).toBe('rest');
    expect(toScoreEntity({ ...base, pitches: ['C4'], fingerings: ['none'] })).toMatchObject({
      type: 'note',
      pitch: 'C4',
    });
    expect(toScoreEntity({ ...base, pitches: ['C4', 'E4'], fingerings: ['1', '3'] })).toMatchObject({
      type: 'chord',
      pitches: ['C4', 'E4'],
    });
  });

  it('converts note, chord, and rest entities into one editable shape', () => {
    const entities: ScoreEntity[] = [
      {
        type: 'note',
        pitch: 'G5',
        duration: 'durationQuarter',
        stemDirection: 'up',
        fingering: '2',
      },
      {
        type: 'chord',
        pitches: ['C4', 'E4', 'G4'],
        duration: 'durationHalf',
        fingerings: ['1', '3', '5'],
      },
      {
        type: 'rest',
        duration: 'durationEighth',
      },
    ];

    expect(toEditableEvent(entities[0]).pitches).toEqual(['G5']);
    expect(toEditableEvent(entities[1]).pitches).toEqual(['C4', 'E4', 'G4']);
    expect(toEditableEvent(entities[2]).pitches).toEqual([]);
  });

  it('lets pitch add/delete drive rest-note-chord transitions', () => {
    const rest = createDefaultEditableEvent();
    const note = addPitch(rest, 'D4');
    const chord = addPitch(note, 'F4');
    const backToNote = removePitch(chord, 1);
    const backToRest = removePitch(backToNote, 0);

    expect(getEditableEventKind(note)).toBe('note');
    expect(getEditableEventKind(chord)).toBe('chord');
    expect(getEditableEventKind(backToNote)).toBe('note');
    expect(getEditableEventKind(backToRest)).toBe('rest');
  });
});
