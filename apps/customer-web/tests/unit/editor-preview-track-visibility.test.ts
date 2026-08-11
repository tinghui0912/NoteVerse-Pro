import { describe, expect, it } from 'vitest';
import {
  getHiddenConnectionPairs,
  getHiddenSourceIds,
  getHiddenStaffKeys,
} from '@/components/editor/editor-preview-track-visibility';
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
              notes: [
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
              notes: [
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
              notes: [
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
  connections: {
    entityInfoMap: new Map(),
    noteConnections: new Map([
      [
        'note-c',
        {
          ties: [
            {
              partnerId: 'chord-eg',
              type: 'start',
              sourceId: 'note-c-src',
              partnerSourceId: 'note-e-src',
            },
          ],
          slurs: [
            {
              slurId: 'slur-1',
              type: 'start',
              partnerIds: ['note-c', 'note-a'],
              sourceId: 'note-c-src',
              partnerSourceIds: ['note-c-src', 'note-a'],
            },
          ],
          beams: [],
        },
      ],
    ]),
  },
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

  it('returns connection endpoint pairs when either endpoint belongs to a hidden track', () => {
    const hiddenSourceIds = getHiddenSourceIds(scoreData, new Set(['voice-1']));

    expect(getHiddenConnectionPairs(scoreData, hiddenSourceIds)).toEqual([
      { startId: 'note-c-src', endId: 'note-e-src' },
      { startId: 'note-c-src', endId: 'note-a' },
    ]);
  });

  it('returns no hidden connection pairs when no source ids are hidden', () => {
    expect(getHiddenConnectionPairs(scoreData, new Set())).toEqual([]);
  });

  it('returns staff keys only when every populated voice in that staff is hidden', () => {
    expect(Array.from(getHiddenStaffKeys(scoreData, new Set(['voice-1'])))).toEqual(['1:0']);
    expect(Array.from(getHiddenStaffKeys(scoreData, new Set(['voice-1', 'voice-2'])))).toEqual([]);
  });

  it('handles missing score data as empty visibility projections', () => {
    expect(Array.from(getHiddenSourceIds(null, new Set()))).toEqual([]);
    expect(getHiddenConnectionPairs(null, new Set(['note-a']))).toEqual([]);
    expect(Array.from(getHiddenStaffKeys(null, new Set()))).toEqual([]);
  });
});
