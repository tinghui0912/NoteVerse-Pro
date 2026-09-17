import { describe, expect, it } from 'vitest';
import type { ParsedScoreEvent } from '@/types/score-types';
import {
  addPitch,
  createDefaultEditableEvent,
  getEditableEventDisplayKind,
  getEditableEventSummaryIcon,
  getEditableEventSummaryPitch,
  isExplicitRestEditableEvent,
  isPitchedEditableEvent,
  removePitch,
  toEditableEvent,
} from './event-inspector-editable-event';

describe('event inspector editable event view model', () => {
  it('describes the transitional display kind from the editable event shape', () => {
    expect(getEditableEventDisplayKind({ pitches: [] })).toBe('explicitRest');
    expect(getEditableEventDisplayKind({ pitches: ['C4'] })).toBe('singleNote');
    expect(getEditableEventDisplayKind({ pitches: ['C4', 'E4'] })).toBe('chord');
  });

  it('separates explicit-rest and pitched editable events', () => {
    expect(isExplicitRestEditableEvent({ pitches: [] })).toBe(true);
    expect(isExplicitRestEditableEvent({ pitches: ['C4'] })).toBe(false);
    expect(isPitchedEditableEvent({ pitches: [] })).toBe(false);
    expect(isPitchedEditableEvent({ pitches: ['C4'] })).toBe(true);
  });

  it('summarizes editable event pitch and icon from the shared editable shape', () => {
    expect(getEditableEventSummaryPitch({ pitches: [] }, 'Rest')).toBe('Rest');
    expect(getEditableEventSummaryPitch({ pitches: ['C4'] }, 'Rest')).toBe('C4');
    expect(getEditableEventSummaryPitch({ pitches: ['C4', 'E4'] }, 'Rest')).toBe('C4 + E4');

    expect(getEditableEventSummaryIcon({ pitches: [] })).toBe('rest');
    expect(getEditableEventSummaryIcon({ pitches: ['C4'] })).toBe('note');
    expect(getEditableEventSummaryIcon({ pitches: ['C4', 'E4'] })).toBe('chord');
  });

  it('uses an empty pitch array as the default insert event', () => {
    const event = createDefaultEditableEvent();

    expect(event.pitches).toEqual([]);
    expect(event.duration).toBe('durationQuarter');
  });

  it('converts note, chord, and rest entities into one editable shape', () => {
    const entities: ParsedScoreEvent[] = [
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

  it('lets pitch add/delete drive rest-to-pitched and chord-to-note transitions', () => {
    const rest = createDefaultEditableEvent();
    const note = addPitch(rest, 'D4');
    const chord = addPitch(note, 'F4');
    const backToNote = removePitch(chord, 1);

    expect(getEditableEventDisplayKind(note)).toBe('singleNote');
    expect(getEditableEventDisplayKind(chord)).toBe('chord');
    expect(getEditableEventDisplayKind(backToNote)).toBe('singleNote');
  });

  it('does not turn the last pitch into a rest through pitch deletion', () => {
    const note = addPitch(createDefaultEditableEvent(), 'D4');

    expect(removePitch(note, 0)).toBe(note);
  });
});
