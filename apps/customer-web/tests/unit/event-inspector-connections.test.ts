import { describe, expect, it } from 'vitest';
import {
  buildDomainSlurDetails,
  buildDomainTieDetails,
  getEntitySourcePitch,
} from '@/components/editor/event-inspector-connections';
import type { EventId, MeasureId, NoteAtomId, NotationId, PartId, ScoreDocument, ScoreDocumentId, StaffId, TieId, VoiceId } from '@/lib/editor-domain';
import type { EntityInfo, ScoreData } from '@/types/score-types';

const chordScoreData: ScoreData = {
  measures: [
    {
      number: 1,
      staves: [
        {
          clef: 'treble',
          name: 'Treble',
          voices: [
            {
              name: '1',
              events: [
                {
                  type: 'chord',
                  pitches: ['C4', 'E4'],
                  duration: 'durationQuarter',
                  meta: {
                    id: 'chord-1',
                    sourceIds: ['note-c', 'note-e'],
                    measureIndex: 0,
                    staveIndex: 0,
                    xmlVoice: 1,
                    entityIndex: 0,
                    startTick: 0,
                  },
                },
                {
                  type: 'note',
                  pitch: 'G4',
                  duration: 'durationQuarter',
                  meta: {
                    id: 'note-2',
                    sourceIds: ['note-g'],
                    measureIndex: 0,
                    staveIndex: 0,
                    xmlVoice: 1,
                    entityIndex: 1,
                    startTick: 4,
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const entityInfo = new Map<string, EntityInfo>([
  [
    'chord-1',
    {
      pitch: 'C4+E4',
      measureNumber: 1,
      staveLabel: 'Treble',
      voiceNumber: 1,
      position: 1,
    },
  ],
  [
    'note-2',
    {
      pitch: 'G4',
      measureNumber: 1,
      staveLabel: 'Treble',
      voiceNumber: 1,
      position: 2,
    },
  ],
]);

const domainDocument: ScoreDocument = {
  schemaVersion: 1,
  id: 'score-1' as ScoreDocumentId,
  parts: [{ id: 'P1' as PartId, name: 'Piano' }],
  staves: [{ id: 'staff-1' as StaffId, partId: 'P1' as PartId, index: 0 }],
  voices: [{ id: 'voice-1' as VoiceId, partId: 'P1' as PartId, homeStaffId: 'staff-1' as StaffId, stemPolicy: 'automatic' }],
  measures: [{ id: 'measure-1' as MeasureId, number: 1 }],
  events: [
    {
      id: 'event-chord' as EventId,
      kind: 'pitched',
      voiceId: 'voice-1' as VoiceId,
      staffId: 'staff-1' as StaffId,
      position: { measureId: 'measure-1' as MeasureId, offset: { numerator: 0, denominator: 1 } },
      rhythm: {
        timelineDuration: { numerator: 1, denominator: 1 },
        notation: { base: 'quarter', dots: 0 },
      },
      notes: [
        { id: 'note-c' as NoteAtomId, pitch: { step: 'C', octave: 4 }, source: { musicXmlElementId: 'note-c' } },
        { id: 'note-e' as NoteAtomId, pitch: { step: 'E', octave: 4 }, source: { musicXmlElementId: 'note-e' } },
      ],
      source: { musicXmlElementIds: ['note-c', 'note-e'] },
    },
    {
      id: 'event-note-2' as EventId,
      kind: 'pitched',
      voiceId: 'voice-1' as VoiceId,
      staffId: 'staff-1' as StaffId,
      position: { measureId: 'measure-1' as MeasureId, offset: { numerator: 1, denominator: 1 } },
      rhythm: {
        timelineDuration: { numerator: 1, denominator: 1 },
        notation: { base: 'quarter', dots: 0 },
      },
      notes: [
        { id: 'note-g' as NoteAtomId, pitch: { step: 'G', octave: 4 }, source: { musicXmlElementId: 'note-g' } },
      ],
      source: { musicXmlElementIds: ['note-g'] },
    },
  ],
  beamRelationships: [],
  tieRelationships: [
    {
      id: 'tie-1' as TieId,
      startNoteAtomId: 'note-e' as NoteAtomId,
      stopNoteAtomId: 'note-g' as NoteAtomId,
    },
  ],
  slurRelationships: [
    {
      id: 'slur-1' as NotationId,
      startNoteAtomId: 'note-c' as NoteAtomId,
      stopNoteAtomId: 'note-g' as NoteAtomId,
    },
  ],
  notationControls: [
    {
      kind: 'tieNotation',
      tieId: 'tie-1' as TieId,
      placement: 'above',
    },
    {
      kind: 'slurNotation',
      notationId: 'slur-1' as NotationId,
      placement: 'below',
    },
  ],
};

describe('event inspector connection helpers', () => {
  it('resolves chord member pitch from source id before falling back to summary text', () => {
    expect(getEntitySourcePitch(chordScoreData, 'chord-1', 'note-e', entityInfo.get('chord-1') ?? null, 'Unknown')).toBe('E4');
    expect(getEntitySourcePitch(chordScoreData, 'chord-1', undefined, entityInfo.get('chord-1') ?? null, 'Unknown')).toBe('C4+E4');
    expect(getEntitySourcePitch(chordScoreData, 'missing', undefined, null, 'Unknown')).toBe('Unknown');
  });

  it('uses fallback text for malformed empty chord pitch summaries', () => {
    const malformedScoreData: ScoreData = {
      measures: [
        {
          number: 1,
          staves: [
            {
              clef: 'treble',
              name: 'Treble',
              voices: [
                {
                  name: '1',
                  events: [
                    {
                      type: 'chord',
                      pitches: [],
                      duration: 'durationQuarter',
                      meta: {
                        id: 'empty-chord',
                        measureIndex: 0,
                        staveIndex: 0,
                        xmlVoice: 1,
                        entityIndex: 0,
                        startTick: 0,
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    expect(getEntitySourcePitch(malformedScoreData, 'empty-chord', undefined, null, 'Unknown')).toBe('Unknown');
  });

  it('builds tie details from domain relationships and notation controls', () => {
    const chordEvent = domainDocument.events[0];
    expect(chordEvent?.kind).toBe('pitched');
    if (chordEvent?.kind !== 'pitched') return;

    const details = buildDomainTieDetails({
      document: domainDocument,
      event: chordEvent,
      scoreData: chordScoreData,
    });

    expect(details).toEqual([
      expect.objectContaining({
        type: 'tie',
        currentId: 'chord-1',
        partnerId: 'note-2',
        sourceId: 'note-e',
        partnerSourceId: 'note-g',
        direction: 'above',
      }),
    ]);
  });

  it('builds slur details from domain relationships and notation controls', () => {
    const chordEvent = domainDocument.events[0];
    expect(chordEvent?.kind).toBe('pitched');
    if (chordEvent?.kind !== 'pitched') return;

    const details = buildDomainSlurDetails({
      document: domainDocument,
      event: chordEvent,
      scoreData: chordScoreData,
    });

    expect(details).toEqual([
      expect.objectContaining({
        type: 'slur',
        currentId: 'chord-1',
        partnerId: 'note-2',
        sourceId: 'note-c',
        partnerSourceId: 'note-g',
        direction: 'below',
      }),
    ]);
  });

});
