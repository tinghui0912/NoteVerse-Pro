import { describe, expect, it } from 'vitest';

import {
  applyMusicXmlCursorInstruction,
  createBeamRelationship,
  createExplicitRestEvent,
  createPitchedEvent,
  createSlurRelationship,
  createTimelineGap,
  createTieRelationship,
  deleteVoiceEventAndDeriveGaps,
  getPitchedEventDisplayKind,
  isVoiceEvent,
  type BeamId,
  type EventId,
  type MeasureId,
  type NoteAtom,
  type NoteAtomId,
  type NotationId,
  type PartId,
  type RhythmicValue,
  type StaffId,
  type VoiceId,
} from './model';

const partId = 'part-1' as PartId;
const voiceId = 'voice-1' as VoiceId;
const staffId = 'staff-1' as StaffId;
const measureId = 'measure-1' as MeasureId;

const quarter: RhythmicValue = {
  timelineDuration: { numerator: 1, denominator: 1 },
  notation: {
    base: 'quarter',
    dots: 0,
  },
};

function noteAtom(id: string, step: NoteAtom['pitch']['step']): NoteAtom {
  return {
    id: id as NoteAtom['id'],
    pitch: {
      step,
      octave: 4,
    },
  };
}

function pitchedEvent(id: string, offset: number, notes: NoteAtom[] = [noteAtom(`${id}-note`, 'C')]) {
  return createPitchedEvent({
    id: id as EventId,
    voiceId,
    staffId,
    position: {
      measureId,
      offset: {
        numerator: offset,
        denominator: 1,
      },
    },
    rhythm: quarter,
    notes,
  });
}

describe('editor domain model invariants', () => {
  it('models a note and a chord as the same pitched event kind', () => {
    const note = pitchedEvent('event-note', 0, [noteAtom('note-c', 'C')]);
    const chord = pitchedEvent('event-chord', 0, [
      noteAtom('note-c', 'C'),
      noteAtom('note-e', 'E'),
      noteAtom('note-g', 'G'),
    ]);

    expect(note.kind).toBe('pitched');
    expect(chord.kind).toBe('pitched');
    expect(getPitchedEventDisplayKind(note)).toBe('note');
    expect(getPitchedEventDisplayKind(chord)).toBe('chord');
  });

  it('rejects pitched events without note atoms', () => {
    expect(() => pitchedEvent('empty-event', 0, [])).toThrow('PitchedEvent requires at least one NoteAtom.');
  });

  it('rejects beam relationships without at least two events', () => {
    expect(() => createBeamRelationship({
      id: 'beam-1' as BeamId,
      eventIds: ['event-1' as EventId],
    })).toThrow('BeamRelationship requires at least two events.');
  });

  it('rejects tie relationships that point to the same note atom twice', () => {
    expect(() => createTieRelationship({
      id: 'tie-1' as never,
      startNoteAtomId: 'note-1' as NoteAtomId,
      stopNoteAtomId: 'note-1' as NoteAtomId,
    })).toThrow('TieRelationship requires two distinct note atoms.');
  });

  it('rejects slur relationships that point to the same note atom twice', () => {
    expect(() => createSlurRelationship({
      id: 'slur-1' as NotationId,
      startNoteAtomId: 'note-1' as NoteAtomId,
      stopNoteAtomId: 'note-1' as NoteAtomId,
    })).toThrow('SlurRelationship requires two distinct note atoms.');
  });

  it('keeps explicit rests separate from timeline gaps', () => {
    const rest = createExplicitRestEvent({
      id: 'rest-1' as EventId,
      voiceId,
      staffId,
      position: {
        measureId,
        offset: {
          numerator: 1,
          denominator: 1,
        },
      },
      rhythm: quarter,
    });
    const gap = createTimelineGap({
      voiceId,
      staffId,
      start: {
        measureId,
        offset: {
          numerator: 2,
          denominator: 1,
        },
      },
      duration: {
        numerator: 1,
        denominator: 1,
      },
    });

    expect(rest.kind).toBe('explicitRest');
    expect(gap.kind).toBe('timelineGap');
    expect(isVoiceEvent(rest)).toBe(true);
    expect(isVoiceEvent(gap)).toBe(false);
  });

  it('deletes a voice event by producing a derived gap instead of a stored rest', () => {
    const first = pitchedEvent('event-1', 0);
    const second = pitchedEvent('event-2', 2);

    const result = deleteVoiceEventAndDeriveGaps({
      events: [first, second],
      eventId: first.id,
      measureId,
      staffId,
      voiceId,
      measureDuration: {
        numerator: 4,
        denominator: 1,
      },
    });

    expect(result.events).toEqual([second]);
    expect(result.events.some((event) => event.kind === 'explicitRest')).toBe(false);
    expect(result.gaps).toMatchObject([
      {
        kind: 'timelineGap',
        start: {
          offset: {
            numerator: 0,
            denominator: 1,
          },
        },
        duration: {
          numerator: 2,
          denominator: 1,
        },
      },
      {
        kind: 'timelineGap',
        start: {
          offset: {
            numerator: 3,
            denominator: 1,
          },
        },
        duration: {
          numerator: 1,
          denominator: 1,
        },
      },
    ]);
  });

  it('treats MusicXML forward and backup as cursor instructions only', () => {
    const afterForward = applyMusicXmlCursorInstruction(
      { numerator: 0, denominator: 1 },
      {
        kind: 'forward',
        duration: {
          numerator: 1,
          denominator: 2,
        },
      }
    );
    const afterBackup = applyMusicXmlCursorInstruction(afterForward, {
      kind: 'backup',
      duration: {
        numerator: 1,
        denominator: 4,
      },
    });

    expect(afterForward).toEqual({ numerator: 1, denominator: 2 });
    expect(afterBackup).toEqual({ numerator: 1, denominator: 4 });
    expect(isVoiceEvent({ kind: 'forward' })).toBe(false);
  });

  it('does not depend on a part id to decide event identity', () => {
    const event = pitchedEvent('event-1', 0);

    expect(partId).toBe('part-1');
    expect(event.voiceId).toBe(voiceId);
    expect(event.staffId).toBe(staffId);
  });
});
