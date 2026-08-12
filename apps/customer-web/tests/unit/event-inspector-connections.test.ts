import { describe, expect, it } from 'vitest';
import {
  buildSlurDetails,
  buildTieDetails,
  getEntitySourcePitch,
} from '@/components/editor/event-inspector-connections';
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
              notes: [
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

describe('event inspector connection helpers', () => {
  it('resolves chord member pitch from source id before falling back to summary text', () => {
    expect(getEntitySourcePitch(chordScoreData, 'chord-1', 'note-e', entityInfo.get('chord-1') ?? null, 'Unknown')).toBe('E4');
    expect(getEntitySourcePitch(chordScoreData, 'chord-1', undefined, entityInfo.get('chord-1') ?? null, 'Unknown')).toBe('C4+E4');
    expect(getEntitySourcePitch(chordScoreData, 'missing', undefined, null, 'Unknown')).toBe('Unknown');
  });

  it('builds tie details from entity connection metadata', () => {
    const details = buildTieDetails(
      'chord-1',
      [{ partnerId: 'note-2', type: 'start', sourceId: 'note-e', partnerSourceId: 'note-g' }],
      entityInfo,
      chordScoreData,
      null
    );

    expect(details).toHaveLength(1);
    expect(details[0]).toMatchObject({
      id: 'tie-chord-1-note-2-start-0',
      type: 'tie',
      currentId: 'chord-1',
      partnerId: 'note-2',
      sourceId: 'note-e',
      partnerSourceId: 'note-g',
      direction: 'auto',
    });
  });

  it('filters slur details without a partner endpoint', () => {
    expect(
      buildSlurDetails(
        'chord-1',
        [{ slurId: 'slur-empty', type: 'start', partnerIds: [] }],
        entityInfo,
        chordScoreData,
        null
      )
    ).toEqual([]);
  });
});
