import { describe, expect, it } from 'vitest';
import { findEntityById, findEntityMetaById } from '@/lib/editor/score-lookup';
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
                    id: 'note-1',
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

  it('returns null when score data or entity id is unavailable', () => {
    expect(findEntityById(null, 'note-1')).toBeNull();
    expect(findEntityById(scoreData, 'missing')).toBeNull();
    expect(findEntityMetaById(scoreData, 'missing')).toBeNull();
  });
});
