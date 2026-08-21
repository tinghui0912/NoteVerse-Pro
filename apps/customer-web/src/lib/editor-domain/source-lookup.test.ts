import { describe, expect, it } from 'vitest';

import type { EventId, NoteAtom, NoteAtomId, ScoreDocument, VoiceEvent } from './model';
import {
  findNoteAtomByMusicXmlElementId,
  findVoiceEventByMusicXmlElementIds,
  getVoiceEventMusicXmlElementIds,
} from './source-lookup';
import {
  createTestScoreDocument,
  testMeasureId,
  testStaffId,
  testVoiceId,
} from './test-fixtures';

function pitchedEvent(id: string, sourceIds: string[]): VoiceEvent {
  const notes = sourceIds.map((sourceId, index): NoteAtom => ({
    id: `${id}-note-${index}` as NoteAtomId,
    pitch: { step: index === 0 ? 'C' : 'E', octave: 4 },
    source: { musicXmlElementId: sourceId },
  }));
  if (notes.length === 0) throw new Error('test pitchedEvent requires at least one source id');

  return {
    id: id as EventId,
    kind: 'pitched',
    voiceId: testVoiceId,
    staffId: testStaffId,
    position: { measureId: testMeasureId, offset: { numerator: 0, denominator: 1 } },
    rhythm: {
      timelineDuration: { numerator: 1, denominator: 1 },
      notation: { base: 'quarter', dots: 0 },
    },
    notes: notes as [NoteAtom, ...NoteAtom[]],
    source: { musicXmlElementIds: sourceIds },
  };
}

function restEvent(id: string, sourceId: string): VoiceEvent {
  return {
    id: id as EventId,
    kind: 'explicitRest',
    voiceId: testVoiceId,
    staffId: testStaffId,
    position: { measureId: testMeasureId, offset: { numerator: 1, denominator: 1 } },
    rhythm: {
      timelineDuration: { numerator: 1, denominator: 1 },
      notation: { base: 'quarter', dots: 0 },
    },
    source: { musicXmlElementId: sourceId },
  };
}

describe('editor domain MusicXML source lookup', () => {
  it('collects source ids represented by pitched and explicit rest events', () => {
    expect(getVoiceEventMusicXmlElementIds(pitchedEvent('chord-1', ['note-1', 'note-2']))).toEqual([
      'note-1',
      'note-2',
    ]);
    expect(getVoiceEventMusicXmlElementIds(restEvent('rest-1', 'rest-source-1'))).toEqual(['rest-source-1']);
  });

  it('finds a domain voice event by any represented MusicXML element id', () => {
    const document: ScoreDocument = createTestScoreDocument({
      events: [
        pitchedEvent('chord-1', ['note-1', 'note-2']),
        restEvent('rest-1', 'rest-source-1'),
      ],
    });

    expect(findVoiceEventByMusicXmlElementIds(document, ['note-2'])?.id).toBe('chord-1');
    expect(findVoiceEventByMusicXmlElementIds(document, ['rest-source-1'])?.id).toBe('rest-1');
    expect(findVoiceEventByMusicXmlElementIds(document, ['missing'])).toBeNull();
  });

  it('finds the exact note atom by MusicXML source id', () => {
    const document: ScoreDocument = createTestScoreDocument({
      events: [
        pitchedEvent('chord-1', ['note-root', 'note-member']),
        restEvent('rest-1', 'rest-source-1'),
      ],
    });

    expect(findNoteAtomByMusicXmlElementId(document, 'note-member')).toMatchObject({
      event: {
        id: 'chord-1',
        kind: 'pitched',
      },
      note: {
        id: 'chord-1-note-1',
        source: { musicXmlElementId: 'note-member' },
      },
    });
    expect(findNoteAtomByMusicXmlElementId(document, 'rest-source-1')).toBeNull();
    expect(findNoteAtomByMusicXmlElementId(document, 'missing')).toBeNull();
    expect(findNoteAtomByMusicXmlElementId(document, '')).toBeNull();
  });
});
