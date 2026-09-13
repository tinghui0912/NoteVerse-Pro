import { describe, expect, it } from 'vitest';
import {
  findEntityById,
  findEntityBySourceIds,
  findEntityMetaById,
} from '@/lib/editor/score-lookup';
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
                    id: 'note-1',
                    measureIndex: 0,
                    staveIndex: 0,
                    xmlVoice: 1,
                    entityIndex: 0,
                    startTick: 0,
                  },
                },
                {
                  type: 'chord',
                  pitches: ['E4', 'G4'],
                  duration: 'durationQuarter',
                  meta: {
                    id: 'chord-root',
                    sourceIds: ['chord-root', 'chord-member'],
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

describe('score lookup helpers', () => {
  it('finds an entity and its metadata by id', () => {
    const result = findEntityById(scoreData, 'note-1');

    expect(result?.entity.type).toBe('note');
    expect(result?.meta).toEqual({
      id: 'note-1',
      measureIndex: 0,
      staveIndex: 0,
      xmlVoice: 1,
      entityIndex: 0,
      startTick: 0,
    });
  });

  it('finds entity metadata by id', () => {
    expect(findEntityMetaById(scoreData, 'note-1')?.id).toBe('note-1');
  });

  it('finds an entity by any represented MusicXML source id', () => {
    const byRoot = findEntityBySourceIds(scoreData, ['chord-root']);
    const byMember = findEntityBySourceIds(scoreData, ['chord-member']);

    expect(byRoot?.entity.type).toBe('chord');
    expect(byRoot?.meta.id).toBe('chord-root');
    expect(byMember?.entity.type).toBe('chord');
    expect(byMember?.meta.id).toBe('chord-root');
  });

  it('prefers source-id matches before legacy entity ids', () => {
    const result = findEntityBySourceIds(scoreData, ['chord-member', 'note-1']);

    expect(result?.meta.id).toBe('chord-root');
  });

  it('returns null when score data or entity id is unavailable', () => {
    expect(findEntityById(null, 'note-1')).toBeNull();
    expect(findEntityById(scoreData, 'missing')).toBeNull();
    expect(findEntityMetaById(scoreData, 'missing')).toBeNull();
    expect(findEntityBySourceIds(null, ['note-1'])).toBeNull();
    expect(findEntityBySourceIds(scoreData, [])).toBeNull();
    expect(findEntityBySourceIds(scoreData, ['missing'])).toBeNull();
  });
});
