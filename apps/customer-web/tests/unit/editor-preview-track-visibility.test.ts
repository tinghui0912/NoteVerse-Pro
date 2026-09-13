import { describe, expect, it } from 'vitest';
import {
  getHiddenConnectionPairs,
  getHiddenSourceIds,
  getHiddenStaffKeys,
} from '@/components/editor/editor-preview-track-visibility';
import type { EventId, MeasureId, NoteAtomId, NotationId, PartId, ScoreDocument, ScoreDocumentId, StaffId, TieId, VoiceId } from '@/lib/editor-domain';
import type { ScoreData } from '@/types/score-types';

const scoreData: ScoreData = {
  measures: [
    {
      number: 1,
      staves: [
        {
          clef: 'treble',
          name: 'Treble',
          voices: [
            {
              name: 'voiceLabel 1',
              events: [
                {
                  type: 'note',
                  pitch: 'C4',
                  duration: 'durationQuarter',
                  meta: {
                    id: 'note-c',
                    sourceIds: ['note-c-src'],
                    measureIndex: 0,
                    staveIndex: 0,
                    xmlVoice: 1,
                    entityIndex: 0,
                    startTick: 0,
                  },
                },
              ],
            },
            {
              name: 'voiceLabel 2',
              events: [
                {
                  type: 'chord',
                  pitches: ['E4', 'G4'],
                  duration: 'durationQuarter',
                  meta: {
                    id: 'chord-eg',
                    sourceIds: ['note-e-src', 'note-g-src'],
                    measureIndex: 0,
                    staveIndex: 0,
                    xmlVoice: 2,
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
    {
      number: 2,
      staves: [
        {
          clef: 'treble',
          name: 'Treble',
          voices: [
            {
              name: 'voiceLabel 2',
              events: [
                {
                  type: 'note',
                  pitch: 'A4',
                  duration: 'durationQuarter',
                  meta: {
                    id: 'note-a',
                    measureIndex: 1,
                    staveIndex: 0,
                    xmlVoice: 2,
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

const domainDocument: ScoreDocument = {
  schemaVersion: 1,
  id: 'score-1' as ScoreDocumentId,
  parts: [{ id: 'P1' as PartId, name: 'Piano' }],
  staves: [{ id: 'staff-1' as StaffId, partId: 'P1' as PartId, index: 0 }],
  voices: [
    { id: 'voice-1' as VoiceId, partId: 'P1' as PartId, homeStaffId: 'staff-1' as StaffId, stemPolicy: 'automatic' },
    { id: 'voice-2' as VoiceId, partId: 'P1' as PartId, homeStaffId: 'staff-1' as StaffId, stemPolicy: 'automatic' },
  ],
  measures: [
    { id: 'measure-1' as MeasureId, number: 1 },
    { id: 'measure-2' as MeasureId, number: 2 },
  ],
  events: [
    {
      id: 'event-c' as EventId,
      kind: 'pitched',
      voiceId: 'voice-1' as VoiceId,
      staffId: 'staff-1' as StaffId,
      position: { measureId: 'measure-1' as MeasureId, offset: { numerator: 0, denominator: 1 } },
      rhythm: {
        timelineDuration: { numerator: 1, denominator: 1 },
        notation: { base: 'quarter', dots: 0 },
      },
      notes: [
        { id: 'note-c' as NoteAtomId, pitch: { step: 'C', octave: 4 }, source: { musicXmlElementId: 'note-c-src' } },
      ],
    },
    {
      id: 'event-eg' as EventId,
      kind: 'pitched',
      voiceId: 'voice-2' as VoiceId,
      staffId: 'staff-1' as StaffId,
      position: { measureId: 'measure-1' as MeasureId, offset: { numerator: 1, denominator: 1 } },
      rhythm: {
        timelineDuration: { numerator: 1, denominator: 1 },
        notation: { base: 'quarter', dots: 0 },
      },
      notes: [
        { id: 'note-e' as NoteAtomId, pitch: { step: 'E', octave: 4 }, source: { musicXmlElementId: 'note-e-src' } },
        { id: 'note-g' as NoteAtomId, pitch: { step: 'G', octave: 4 }, source: { musicXmlElementId: 'note-g-src' } },
      ],
    },
    {
      id: 'event-a' as EventId,
      kind: 'pitched',
      voiceId: 'voice-2' as VoiceId,
      staffId: 'staff-1' as StaffId,
      position: { measureId: 'measure-2' as MeasureId, offset: { numerator: 0, denominator: 1 } },
      rhythm: {
        timelineDuration: { numerator: 1, denominator: 1 },
        notation: { base: 'quarter', dots: 0 },
      },
      notes: [
        { id: 'note-a' as NoteAtomId, pitch: { step: 'A', octave: 4 }, source: { musicXmlElementId: 'note-a' } },
      ],
    },
  ],
  beamRelationships: [],
  tieRelationships: [
    {
      id: 'tie-1' as TieId,
      startNoteAtomId: 'note-c' as NoteAtomId,
      stopNoteAtomId: 'note-e' as NoteAtomId,
    },
  ],
  slurRelationships: [
    {
      id: 'slur-1' as NotationId,
      startNoteAtomId: 'note-c' as NoteAtomId,
      stopNoteAtomId: 'note-a' as NoteAtomId,
    },
  ],
  notationControls: [],
};

describe('editor preview track visibility helpers', () => {
  it('returns source ids for entities in hidden tracks', () => {
    expect(Array.from(getHiddenSourceIds(scoreData, new Set(['voice-1']))).sort()).toEqual([
      'note-a',
      'note-e-src',
      'note-g-src',
    ]);
  });

  it('uses entity id when source ids are unavailable', () => {
    expect(Array.from(getHiddenSourceIds(scoreData, new Set(['voice-1'])))).toContain('note-a');
  });

  it('returns connection endpoint pairs from domain relationships when either endpoint belongs to a hidden track', () => {
    const hiddenSourceIds = getHiddenSourceIds(scoreData, new Set(['voice-1']));

    expect(getHiddenConnectionPairs(hiddenSourceIds, domainDocument)).toEqual([
      { startId: 'note-c-src', endId: 'note-e-src' },
      { startId: 'note-c-src', endId: 'note-a' },
    ]);
  });

  it('returns no hidden connection pairs when no source ids are hidden', () => {
    expect(getHiddenConnectionPairs(new Set(), domainDocument)).toEqual([]);
  });

  it('returns staff keys only when every populated voice in that staff is hidden', () => {
    expect(Array.from(getHiddenStaffKeys(scoreData, new Set(['voice-1'])))).toEqual(['1:0']);
    expect(Array.from(getHiddenStaffKeys(scoreData, new Set(['voice-1', 'voice-2'])))).toEqual([]);
  });

  it('handles missing score data as empty visibility projections', () => {
    expect(Array.from(getHiddenSourceIds(null, new Set()))).toEqual([]);
    expect(getHiddenConnectionPairs(new Set(['note-a']), null)).toEqual([]);
    expect(Array.from(getHiddenStaffKeys(null, new Set()))).toEqual([]);
  });
});
