import { describe, expect, it } from 'vitest';

import {
  addSlurRelationship,
  addTieRelationship,
  addNoteAtom,
  deleteSlurRelationship,
  deleteTieRelationship,
  deleteVoiceEvent,
  insertExplicitRest,
  insertPitchedEvent,
  setSlurRelationshipPlacement,
  removeNoteAtom,
  setEventStemDirectionOverride,
  setTieRelationshipPlacement,
  updateBeamRelationshipAtEvent,
  updatePitchedEvent,
} from './commands';
import type {
  BeamId,
  EventId,
  NoteAtom,
  NoteAtomId,
  NotationId,
  RhythmicValue,
  TieId,
} from './model';
import { getPitchedEventDisplayKind } from './model';
import {
  createTestScoreDocument,
  testMeasureId as measureId,
  testStaffId as staffId,
  testVoiceId as voiceId,
} from './test-fixtures';

const quarter: RhythmicValue = {
  timelineDuration: { numerator: 1, denominator: 1 },
  notation: { base: 'quarter', dots: 0 },
};

const eighth: RhythmicValue = {
  timelineDuration: { numerator: 1, denominator: 2 },
  notation: { base: 'eighth', dots: 0 },
};

function noteAtom(id: string, step: NoteAtom['pitch']['step']): NoteAtom {
  return {
    id: id as NoteAtomId,
    pitch: { step, octave: 4 },
  };
}

function pitchedEvent(id: string, offset: number, notes: NoteAtom[] = [noteAtom(`${id}-note`, 'C')]) {
  return {
    id: id as EventId,
    kind: 'pitched' as const,
    voiceId,
    staffId,
    position: { measureId, offset: { numerator: offset, denominator: 1 } },
    rhythm: quarter,
    notes: notes as [NoteAtom, ...NoteAtom[]],
  };
}

function eighthEvent(id: string, offset: number) {
  return {
    ...pitchedEvent(id, offset),
    rhythm: eighth,
  };
}

describe('editor domain commands', () => {
  it('inserts pitched events and explicit rests through separate commands', () => {
    const withNote = insertPitchedEvent(createTestScoreDocument(), pitchedEvent('event-1', 0));
    expect(withNote.success).toBe(true);
    if (!withNote.success) return;

    const withRest = insertExplicitRest(withNote.document, {
      id: 'rest-1' as EventId,
      voiceId,
      staffId,
      position: { measureId, offset: { numerator: 1, denominator: 1 } },
      rhythm: quarter,
    });

    expect(withRest.success).toBe(true);
    if (!withRest.success) return;
    expect(withRest.document.events.map((event) => event.kind)).toEqual(['pitched', 'explicitRest']);
  });

  it('deletes a voice event and returns derived gaps instead of creating a rest', () => {
    const document = {
      ...createTestScoreDocument({
        events: [
          pitchedEvent('event-1', 0),
          pitchedEvent('event-2', 2),
        ],
      }),
      notationControls: [
        {
          kind: 'eventNotation' as const,
          eventId: 'event-1' as EventId,
          stemDirection: 'up' as const,
        },
        {
          kind: 'eventNotation' as const,
          eventId: 'event-2' as EventId,
          stemDirection: 'down' as const,
        },
        {
          kind: 'slurNotation' as const,
          notationId: 'slur-1' as NotationId,
          placement: 'above' as const,
        },
      ],
      beamRelationships: [
        {
          id: 'beam-1' as BeamId,
          eventIds: ['event-1' as EventId, 'event-2' as EventId] as [EventId, EventId],
        },
      ],
      slurRelationships: [
        {
          id: 'slur-1' as NotationId,
          startNoteAtomId: 'event-1-note' as NoteAtomId,
          stopNoteAtomId: 'event-2-note' as NoteAtomId,
        },
      ],
    };

    const result = deleteVoiceEvent({
      document,
      eventId: 'event-1' as EventId,
      measureDuration: { numerator: 4, denominator: 1 },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.document.events.map((event) => event.id)).toEqual(['event-2']);
    expect(result.document.notationControls).toEqual([
      {
        kind: 'eventNotation',
        eventId: 'event-2',
        stemDirection: 'down',
      },
    ]);
    expect(result.document.events.some((event) => event.kind === 'explicitRest')).toBe(false);
    expect(result.document.beamRelationships).toEqual([]);
    expect(result.document.slurRelationships).toEqual([]);
    expect(result.gaps).toMatchObject([
      {
        start: { offset: { numerator: 0, denominator: 1 } },
        duration: { numerator: 2, denominator: 1 },
      },
      {
        start: { offset: { numerator: 3, denominator: 1 } },
        duration: { numerator: 1, denominator: 1 },
      },
    ]);
  });

  it('deletes a tie relationship and clears related notation state', () => {
    const document = createTestScoreDocument({
      events: [
        pitchedEvent('event-1', 0, [{
          ...noteAtom('note-1', 'C'),
          tieOut: 'tie-1' as TieId,
        }]),
        pitchedEvent('event-2', 1, [{
          ...noteAtom('note-2', 'C'),
          tieIn: 'tie-1' as TieId,
        }]),
      ],
      tieRelationships: [
        {
          id: 'tie-1' as TieId,
          startNoteAtomId: 'note-1' as NoteAtomId,
          stopNoteAtomId: 'note-2' as NoteAtomId,
        },
      ],
      notationControls: [
        {
          kind: 'tieNotation',
          tieId: 'tie-1' as TieId,
          placement: 'above',
        },
      ],
    });

    const result = deleteTieRelationship({
      document,
      tieId: 'tie-1' as TieId,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.document.tieRelationships).toEqual([]);
    expect(result.document.notationControls).toEqual([]);
    const [start, stop] = result.document.events;
    expect(start?.kind).toBe('pitched');
    expect(stop?.kind).toBe('pitched');
    if (start?.kind !== 'pitched' || stop?.kind !== 'pitched') return;
    expect(start.notes[0]?.tieOut).toBeUndefined();
    expect(stop.notes[0]?.tieIn).toBeUndefined();
  });

  it('adds a tie relationship and updates note-atom anchors', () => {
    const document = createTestScoreDocument({
      events: [
        pitchedEvent('event-1', 0, [noteAtom('note-1', 'C')]),
        pitchedEvent('event-2', 1, [noteAtom('note-2', 'C')]),
      ],
    });

    const result = addTieRelationship({
      document,
      startNoteAtomId: 'note-1' as NoteAtomId,
      stopNoteAtomId: 'note-2' as NoteAtomId,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.document.tieRelationships).toEqual([
      {
        id: 'note-1--tie--note-2',
        startNoteAtomId: 'note-1',
        stopNoteAtomId: 'note-2',
      },
    ]);
    const [start, stop] = result.document.events;
    expect(start?.kind).toBe('pitched');
    expect(stop?.kind).toBe('pitched');
    if (start?.kind !== 'pitched' || stop?.kind !== 'pitched') return;
    expect(start.notes[0]?.tieOut).toBe('note-1--tie--note-2');
    expect(stop.notes[0]?.tieIn).toBe('note-1--tie--note-2');

    expect(addTieRelationship({
      document: result.document,
      startNoteAtomId: 'note-1' as NoteAtomId,
      stopNoteAtomId: 'note-2' as NoteAtomId,
    })).toEqual({
      success: false,
      error: 'Tie relationship already exists.',
    });
  });

  it('sets and clears tie placement notation controls', () => {
    const document = createTestScoreDocument({
      events: [
        pitchedEvent('event-1', 0, [noteAtom('note-1', 'C')]),
        pitchedEvent('event-2', 1, [noteAtom('note-2', 'C')]),
      ],
      tieRelationships: [
        {
          id: 'tie-1' as TieId,
          startNoteAtomId: 'note-1' as NoteAtomId,
          stopNoteAtomId: 'note-2' as NoteAtomId,
        },
      ],
    });

    const setAbove = setTieRelationshipPlacement({
      document,
      tieId: 'tie-1' as TieId,
      placement: 'above',
    });
    expect(setAbove.success).toBe(true);
    if (!setAbove.success) return;
    expect(setAbove.document.notationControls).toEqual([
      {
        kind: 'tieNotation',
        tieId: 'tie-1',
        placement: 'above',
      },
    ]);

    const clear = setTieRelationshipPlacement({
      document: setAbove.document,
      tieId: 'tie-1' as TieId,
    });
    expect(clear.success).toBe(true);
    if (!clear.success) return;
    expect(clear.document.notationControls).toEqual([]);
  });

  it('deletes a slur relationship and clears related notation state', () => {
    const document = createTestScoreDocument({
      events: [
        pitchedEvent('event-1', 0, [noteAtom('note-1', 'C')]),
        pitchedEvent('event-2', 1, [noteAtom('note-2', 'E')]),
      ],
      slurRelationships: [
        {
          id: 'slur-1' as NotationId,
          startNoteAtomId: 'note-1' as NoteAtomId,
          stopNoteAtomId: 'note-2' as NoteAtomId,
        },
      ],
      notationControls: [
        {
          kind: 'slurNotation',
          notationId: 'slur-1' as NotationId,
          placement: 'above',
        },
      ],
    });

    const result = deleteSlurRelationship({
      document,
      notationId: 'slur-1' as NotationId,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.document.slurRelationships).toEqual([]);
    expect(result.document.notationControls).toEqual([]);
  });

  it('adds a slur relationship', () => {
    const document = createTestScoreDocument({
      events: [
        pitchedEvent('event-1', 0, [noteAtom('note-1', 'C')]),
        pitchedEvent('event-2', 1, [noteAtom('note-2', 'E')]),
      ],
    });

    const result = addSlurRelationship({
      document,
      startNoteAtomId: 'note-1' as NoteAtomId,
      stopNoteAtomId: 'note-2' as NoteAtomId,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.document.slurRelationships).toEqual([
      {
        id: 'note-1--slur--note-2',
        startNoteAtomId: 'note-1',
        stopNoteAtomId: 'note-2',
      },
    ]);
    expect(addSlurRelationship({
      document: result.document,
      startNoteAtomId: 'note-2' as NoteAtomId,
      stopNoteAtomId: 'note-1' as NoteAtomId,
    })).toEqual({
      success: false,
      error: 'Slur relationship already exists.',
    });
  });

  it('sets and clears slur placement notation controls', () => {
    const document = createTestScoreDocument({
      events: [
        pitchedEvent('event-1', 0, [noteAtom('note-1', 'C')]),
        pitchedEvent('event-2', 1, [noteAtom('note-2', 'E')]),
      ],
      slurRelationships: [
        {
          id: 'slur-1' as NotationId,
          startNoteAtomId: 'note-1' as NoteAtomId,
          stopNoteAtomId: 'note-2' as NoteAtomId,
        },
      ],
    });

    const setBelow = setSlurRelationshipPlacement({
      document,
      notationId: 'slur-1' as NotationId,
      placement: 'below',
    });
    expect(setBelow.success).toBe(true);
    if (!setBelow.success) return;
    expect(setBelow.document.notationControls).toEqual([
      {
        kind: 'slurNotation',
        notationId: 'slur-1',
        placement: 'below',
      },
    ]);

    const clear = setSlurRelationshipPlacement({
      document: setBelow.document,
      notationId: 'slur-1' as NotationId,
    });
    expect(clear.success).toBe(true);
    if (!clear.success) return;
    expect(clear.document.notationControls).toEqual([]);
  });

  it('joins the selected event with an adjacent beamable event', () => {
    const document = createTestScoreDocument({
      events: [
        eighthEvent('event-1', 0),
        eighthEvent('event-2', 1),
      ],
    });

    const result = updateBeamRelationshipAtEvent({
      document,
      eventId: 'event-1' as EventId,
      action: 'next',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.document.beamRelationships).toEqual([
      {
        id: 'event-1--beam--event-2',
        eventIds: ['event-1', 'event-2'],
      },
    ]);
  });

  it('splits an existing beam relationship at the selected event edge', () => {
    const document = createTestScoreDocument({
      events: [
        eighthEvent('event-1', 0),
        eighthEvent('event-2', 1),
        eighthEvent('event-3', 2),
        eighthEvent('event-4', 3),
      ],
      beamRelationships: [
        {
          id: 'beam-1' as BeamId,
          eventIds: [
            'event-1' as EventId,
            'event-2' as EventId,
            'event-3' as EventId,
            'event-4' as EventId,
          ] as [EventId, EventId, ...EventId[]],
        },
      ],
    });

    const result = updateBeamRelationshipAtEvent({
      document,
      eventId: 'event-2' as EventId,
      action: 'break-right',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.document.beamRelationships).toEqual([
      {
        id: 'event-1--beam--event-2',
        eventIds: ['event-1', 'event-2'],
      },
      {
        id: 'event-3--beam--event-4',
        eventIds: ['event-3', 'event-4'],
      },
    ]);
  });

  it('adds a note atom to a pitched event without converting event kind', () => {
    const document = createTestScoreDocument({ events: [pitchedEvent('event-1', 0, [noteAtom('note-c', 'C')])] });

    const result = addNoteAtom({
      document,
      eventId: 'event-1' as EventId,
      note: noteAtom('note-e', 'E'),
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const event = result.document.events[0];
    expect(event?.kind).toBe('pitched');
    if (event?.kind === 'pitched') {
      expect(getPitchedEventDisplayKind(event)).toBe('chord');
      expect(event.notes.map((note) => note.pitch.step)).toEqual(['C', 'E']);
    }
  });

  it('removes a note atom from a chord without turning the event into a rest', () => {
    const document = createTestScoreDocument({
      events: [pitchedEvent('event-1', 0, [noteAtom('note-c', 'C'), noteAtom('note-e', 'E')])],
    });

    const result = removeNoteAtom({
      document,
      eventId: 'event-1' as EventId,
      noteAtomId: 'note-e' as NoteAtomId,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const event = result.document.events[0];
    expect(event?.kind).toBe('pitched');
    if (event?.kind === 'pitched') {
      expect(getPitchedEventDisplayKind(event)).toBe('note');
      expect(event.notes).toHaveLength(1);
    }
  });

  it('keeps omitted pitched-event patch fields unchanged', () => {
    const document = createTestScoreDocument({ events: [pitchedEvent('event-1', 0)] });

    const result = updatePitchedEvent({
      document,
      eventId: 'event-1' as EventId,
      patch: {
        rhythm: {
          timelineDuration: { numerator: 2, denominator: 1 },
          notation: { base: 'half', dots: 0 },
        },
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.document.events[0]).toMatchObject({
      id: 'event-1',
      voiceId,
      staffId,
      position: { measureId, offset: { numerator: 0, denominator: 1 } },
      rhythm: {
        timelineDuration: { numerator: 2, denominator: 1 },
        notation: { base: 'half', dots: 0 },
      },
    });
  });

  it('rejects removing the last note atom instead of silently creating a rest', () => {
    const result = removeNoteAtom({
      document: createTestScoreDocument({ events: [pitchedEvent('event-1', 0, [noteAtom('note-c', 'C')])] }),
      eventId: 'event-1' as EventId,
      noteAtomId: 'note-c' as NoteAtomId,
    });

    expect(result).toEqual({
      success: false,
      error: 'Cannot remove the last note atom from a pitched event. Delete the event instead.',
    });
  });

  it('rejects adding note atoms to explicit rests', () => {
    const restInsert = insertExplicitRest(createTestScoreDocument(), {
      id: 'rest-1' as EventId,
      voiceId,
      staffId,
      position: { measureId, offset: { numerator: 0, denominator: 1 } },
      rhythm: quarter,
    });
    expect(restInsert.success).toBe(true);
    if (!restInsert.success) return;

    expect(addNoteAtom({
      document: restInsert.document,
      eventId: 'rest-1' as EventId,
      note: noteAtom('note-c', 'C'),
    })).toEqual({
      success: false,
      error: 'Only pitched events can receive note atoms.',
    });
  });

  it('sets, replaces, and clears event stem direction overrides', () => {
    const document = createTestScoreDocument({ events: [pitchedEvent('event-1', 0)] });

    const setUp = setEventStemDirectionOverride({
      document,
      eventId: 'event-1' as EventId,
      stemDirection: 'up',
    });

    expect(setUp.success).toBe(true);
    if (!setUp.success) return;
    expect(setUp.document.notationControls).toEqual([
      {
        kind: 'eventNotation',
        eventId: 'event-1',
        stemDirection: 'up',
      },
    ]);

    const setDouble = setEventStemDirectionOverride({
      document: setUp.document,
      eventId: 'event-1' as EventId,
      stemDirection: 'double',
    });

    expect(setDouble.success).toBe(true);
    if (!setDouble.success) return;
    expect(setDouble.document.notationControls).toEqual([
      {
        kind: 'eventNotation',
        eventId: 'event-1',
        stemDirection: 'double',
      },
    ]);

    const clear = setEventStemDirectionOverride({
      document: setDouble.document,
      eventId: 'event-1' as EventId,
    });

    expect(clear.success).toBe(true);
    if (!clear.success) return;
    expect(clear.document.notationControls).toEqual([]);
  });

  it('rejects stem direction overrides for missing events', () => {
    expect(setEventStemDirectionOverride({
      document: createTestScoreDocument(),
      eventId: 'missing-event' as EventId,
      stemDirection: 'up',
    })).toEqual({
      success: false,
      error: 'Event does not exist.',
    });
  });

  it('rejects stem direction overrides for explicit rests', () => {
    const withRest = insertExplicitRest(createTestScoreDocument(), {
      id: 'rest-1' as EventId,
      voiceId,
      staffId,
      position: { measureId, offset: { numerator: 0, denominator: 1 } },
      rhythm: quarter,
    });
    expect(withRest.success).toBe(true);
    if (!withRest.success) return;

    expect(setEventStemDirectionOverride({
      document: withRest.document,
      eventId: 'rest-1' as EventId,
      stemDirection: 'up',
    })).toEqual({
      success: false,
      error: 'Only pitched events can have stem direction overrides.',
    });
  });
});
