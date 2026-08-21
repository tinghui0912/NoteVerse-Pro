import { describe, expect, it } from 'vitest';

import type {
  EventId,
  MeasureId,
  NotationId,
  PartId,
  ScoreDocument,
  ScoreDocumentId,
  StaffId,
  TieId,
  VoiceId,
  NoteAtomId,
} from '@/lib/editor-domain';
import {
  getDomainConnectionDeletionSummary,
  validateDomainTieCreation,
} from './use-connection-operations';

const document: ScoreDocument = {
  schemaVersion: 1,
  id: 'score-1' as ScoreDocumentId,
  parts: [{ id: 'P1' as PartId, name: 'Piano' }],
  staves: [{ id: 'staff-1' as StaffId, partId: 'P1' as PartId, index: 0 }],
  voices: [{ id: 'voice-1' as VoiceId, partId: 'P1' as PartId, homeStaffId: 'staff-1' as StaffId, stemPolicy: 'automatic' }],
  measures: [{ id: 'measure-1' as MeasureId, number: 1 }],
  events: [
    {
      id: 'event-a' as EventId,
      kind: 'pitched',
      voiceId: 'voice-1' as VoiceId,
      staffId: 'staff-1' as StaffId,
      position: { measureId: 'measure-1' as MeasureId, offset: { numerator: 0, denominator: 1 } },
      rhythm: {
        timelineDuration: { numerator: 1, denominator: 1 },
        notation: { base: 'quarter', dots: 0 },
      },
      notes: [
        { id: 'note-a' as NoteAtomId, pitch: { step: 'C', octave: 4 }, source: { musicXmlElementId: 'note-a-src' } },
      ],
    },
    {
      id: 'event-b' as EventId,
      kind: 'pitched',
      voiceId: 'voice-1' as VoiceId,
      staffId: 'staff-1' as StaffId,
      position: { measureId: 'measure-1' as MeasureId, offset: { numerator: 1, denominator: 1 } },
      rhythm: {
        timelineDuration: { numerator: 1, denominator: 1 },
        notation: { base: 'quarter', dots: 0 },
      },
      notes: [
        { id: 'note-b' as NoteAtomId, pitch: { step: 'C', octave: 4 }, source: { musicXmlElementId: 'note-b-src' } },
      ],
    },
    {
      id: 'event-c' as EventId,
      kind: 'pitched',
      voiceId: 'voice-1' as VoiceId,
      staffId: 'staff-1' as StaffId,
      position: { measureId: 'measure-1' as MeasureId, offset: { numerator: 2, denominator: 1 } },
      rhythm: {
        timelineDuration: { numerator: 1, denominator: 1 },
        notation: { base: 'quarter', dots: 0 },
      },
      notes: [
        { id: 'note-c' as NoteAtomId, pitch: { step: 'C', octave: 4 }, source: { musicXmlElementId: 'note-c-src' } },
      ],
    },
  ],
  beamRelationships: [],
  tieRelationships: [
    {
      id: 'tie-a-b' as TieId,
      startNoteAtomId: 'note-a' as NoteAtomId,
      stopNoteAtomId: 'note-b' as NoteAtomId,
    },
    {
      id: 'tie-b-c' as TieId,
      startNoteAtomId: 'note-b' as NoteAtomId,
      stopNoteAtomId: 'note-c' as NoteAtomId,
    },
  ],
  slurRelationships: [
    {
      id: 'slur-a-b' as NotationId,
      startNoteAtomId: 'note-a' as NoteAtomId,
      stopNoteAtomId: 'note-b' as NoteAtomId,
    },
    {
      id: 'slur-b-c' as NotationId,
      startNoteAtomId: 'note-b' as NoteAtomId,
      stopNoteAtomId: 'note-c' as NoteAtomId,
    },
  ],
  notationControls: [],
};

describe('connection operations domain read helpers', () => {
  it('summarizes all tie relationships touching selected source ids', () => {
    expect(getDomainConnectionDeletionSummary(document, ['note-b-src'], 'tie')).toEqual({
      relationshipCount: 2,
      endpointSourceIds: ['note-a-src', 'note-b-src', 'note-c-src'],
    });
  });

  it('summarizes all slur relationships touching selected source ids', () => {
    expect(getDomainConnectionDeletionSummary(document, ['note-b-src'], 'slur')).toEqual({
      relationshipCount: 2,
      endpointSourceIds: ['note-a-src', 'note-b-src', 'note-c-src'],
    });
  });

  it('returns an empty summary when selected source ids do not resolve to note atoms', () => {
    expect(getDomainConnectionDeletionSummary(document, ['missing'], 'tie')).toEqual({
      relationshipCount: 0,
      endpointSourceIds: [],
    });
  });

  it('validates tie creation from domain note-atom pitch, staff, and timeline position', () => {
    expect(validateDomainTieCreation({
      document,
      startSourceIds: ['note-a-src'],
      endSourceIds: ['note-b-src'],
    })).toBe('valid');
  });

  it('rejects tie creation when another pitched event sits between endpoints on the same staff', () => {
    expect(validateDomainTieCreation({
      document,
      startSourceIds: ['note-a-src'],
      endSourceIds: ['note-c-src'],
    })).toBe('not-adjacent');
  });

  it('rejects tie creation for different pitches', () => {
    const differentPitchDocument: ScoreDocument = {
      ...document,
      events: document.events.map((event) => {
        if (event.id !== 'event-b') return event;
        if (event.kind !== 'pitched') return event;
        return {
          ...event,
          notes: [
            {
              ...event.notes[0],
              pitch: { step: 'D', octave: 4 },
            },
          ],
        };
      }),
    };

    expect(validateDomainTieCreation({
      document: differentPitchDocument,
      startSourceIds: ['note-a-src'],
      endSourceIds: ['note-b-src'],
    })).toBe('different-pitch');
  });

  it('rejects tie creation across staves', () => {
    const otherStaffDocument: ScoreDocument = {
      ...document,
      staves: [
        ...document.staves,
        { id: 'staff-2' as StaffId, partId: 'P1' as PartId, index: 1 },
      ],
      events: document.events.map((event) => (
        event.id === 'event-b' ? { ...event, staffId: 'staff-2' as StaffId } : event
      )),
    };

    expect(validateDomainTieCreation({
      document: otherStaffDocument,
      startSourceIds: ['note-a-src'],
      endSourceIds: ['note-b-src'],
    })).toBe('different-staff');
  });
});
