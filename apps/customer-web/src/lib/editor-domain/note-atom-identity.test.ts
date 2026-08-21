import { describe, expect, it } from 'vitest';

import type { EventId, NoteAtomId, PitchedEvent, ScoreDocument } from './model';
import { createAppendedNoteAtomIdentity } from './note-atom-identity';

function createDocument(): ScoreDocument {
  const event: PitchedEvent = {
    id: 'event-1' as EventId,
    kind: 'pitched',
    voiceId: 'voice-1' as PitchedEvent['voiceId'],
    staffId: 'staff-1' as PitchedEvent['staffId'],
    position: {
      measureId: 'measure-1' as PitchedEvent['position']['measureId'],
      offset: { numerator: 0, denominator: 1 },
    },
    rhythm: {
      timelineDuration: { numerator: 1, denominator: 1 },
      notation: { base: 'quarter', dots: 0 },
    },
    notes: [{
      id: 'root-note' as NoteAtomId,
      pitch: { step: 'C', octave: 4 },
      source: { musicXmlElementId: 'root-note' },
    }],
    source: { musicXmlElementIds: ['root-note'] },
  };

  return {
    schemaVersion: 1,
    id: 'score-1' as ScoreDocument['id'],
    parts: [],
    staves: [],
    voices: [],
    measures: [],
    events: [event],
    beamRelationships: [],
    tieRelationships: [],
    slurRelationships: [],
    notationControls: [],
  };
}

describe('createAppendedNoteAtomIdentity', () => {
  it('derives a stable source-backed identity from the chord root', () => {
    const document = createDocument();
    const event = document.events[0] as PitchedEvent;

    expect(createAppendedNoteAtomIdentity(document, event)).toEqual({
      noteAtomId: 'root-note-chord-2',
      musicXmlElementId: 'root-note-chord-2',
    });
  });

  it('resolves collisions across every event in the document', () => {
    const document = createDocument();
    const rootEvent = document.events[0] as PitchedEvent;
    document.events.push({
      ...rootEvent,
      id: 'event-2' as EventId,
      notes: [{
        id: 'root-note-chord-2' as NoteAtomId,
        pitch: { step: 'E', octave: 4 },
        source: { musicXmlElementId: 'root-note-chord-2' },
      }],
      source: { musicXmlElementIds: ['root-note-chord-2'] },
    });
    const event = rootEvent;

    expect(createAppendedNoteAtomIdentity(document, event)).toEqual({
      noteAtomId: 'root-note-chord-2-2',
      musicXmlElementId: 'root-note-chord-2-2',
    });
  });
});
