import { describe, expect, it } from 'vitest';

import type { Chord, Note, Rest } from '@/types/score-types';
import type { EditableEvent } from './event-inspector-editable-event';
import { toInspectorDomainDraft } from './event-inspector-domain-adapter';

const baseEvent: EditableEvent = {
  duration: 'durationQuarter',
  dotted: false,
  pitches: [],
  stemDirection: 'none',
  fingerings: [],
  accidentals: [],
};

describe('event inspector domain adapter', () => {
  it('maps an explicit rest edit to an explicit rest draft', () => {
    const rest: Rest = {
      type: 'rest',
      duration: 'durationQuarter',
      meta: {
        id: 'rest-1',
        measureIndex: 0,
        staveIndex: 1,
        xmlVoice: 2,
        entityIndex: 3,
        startTick: 8,
      },
    };

    const draft = toInspectorDomainDraft(rest, {
      ...baseEvent,
      duration: 'durationHalf',
      dotted: true,
    });

    expect(draft).toMatchObject({
      kind: 'explicitRest',
      eventId: 'rest-1',
      voiceId: 'legacy-voice:2',
      staffId: 'legacy-staff:1',
      position: {
        measureId: 'legacy-measure:0',
        offset: { numerator: 8, denominator: 1 },
      },
      rhythm: {
        timelineDuration: { numerator: 3, denominator: 1 },
        notation: { base: 'half', dots: 1 },
      },
    });
  });

  it('maps a pitched edit to one pitched event draft with note atoms', () => {
    const chord: Chord = {
      type: 'chord',
      pitches: ['C4', 'E4'],
      duration: 'durationQuarter',
      meta: {
        id: 'chord-1',
        sourceIds: ['note-1', 'note-2'],
        measureIndex: 1,
        staveIndex: 0,
        xmlVoice: 1,
        entityIndex: 0,
        startTick: 0,
      },
    };

    const draft = toInspectorDomainDraft(chord, {
      ...baseEvent,
      pitches: ['C4', 'F#4'],
      fingerings: ['1', '3'],
      accidentals: [undefined, 'sharp'],
    });

    expect(draft).toMatchObject({
      kind: 'pitchedEvent',
      eventId: 'chord-1',
      notes: [
        {
          id: 'note-1',
          pitch: { step: 'C', octave: 4 },
          fingering: '1',
        },
        {
          id: 'note-2',
          pitch: { step: 'F', octave: 4, alter: 1 },
          accidental: 'sharp',
          fingering: '3',
        },
      ],
    });
  });

  it('maps a single note edit to a pitched event draft', () => {
    const note: Note = {
      type: 'note',
      pitch: 'D4',
      duration: 'durationQuarter',
      stemDirection: 'up',
      meta: {
        id: 'note-1',
        measureIndex: 0,
        staveIndex: 0,
        xmlVoice: 1,
        entityIndex: 0,
        startTick: 0,
      },
    };

    const draft = toInspectorDomainDraft(note, {
      ...baseEvent,
      pitches: ['Ebb5'],
      fingerings: ['2'],
      accidentals: ['flat-flat'],
    });

    expect(draft).toMatchObject({
      kind: 'pitchedEvent',
      eventId: 'note-1',
      notes: [
        {
          pitch: { step: 'E', octave: 5, alter: -2 },
          fingering: '2',
          accidental: 'flat-flat',
        },
      ],
    });
  });
});
