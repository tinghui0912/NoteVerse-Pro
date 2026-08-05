import { describe, expect, it } from 'vitest';
import { buildDirtyMeasureStatuses } from './measure-status';
import type { ScoreData } from '@/types/score-types';

const scoreData: ScoreData = {
  timeSignature: '4/4',
  measures: [
    {
      number: 1,
      staves: [
        {
          clef: 'treble',
          name: 'trebleClef',
          voices: [
            {
              name: 'voiceLabel 1',
              notes: [
                { type: 'note', pitch: 'C4', duration: 'durationQuarter', meta: { id: 'n1', measureIndex: 0, staveIndex: 0, xmlVoice: 1, entityIndex: 0, startTick: 0 } },
                { type: 'note', pitch: 'D4', duration: 'durationQuarter', meta: { id: 'n2', measureIndex: 0, staveIndex: 0, xmlVoice: 1, entityIndex: 1, startTick: 1 } },
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
          name: 'trebleClef',
          voices: [
            {
              name: 'voiceLabel 1',
              notes: [
                { type: 'note', pitch: 'C4', duration: 'durationWhole', meta: { id: 'n3', measureIndex: 1, staveIndex: 0, xmlVoice: 1, entityIndex: 0, startTick: 0 } },
                { type: 'note', pitch: 'D4', duration: 'durationQuarter', meta: { id: 'n4', measureIndex: 1, staveIndex: 0, xmlVoice: 1, entityIndex: 1, startTick: 4 } },
              ],
            },
            {
              name: 'voiceLabel 2',
              notes: [],
            },
          ],
        },
      ],
    },
  ],
};

describe('buildDirtyMeasureStatuses', () => {
  it('marks underfilled and overflowed voices without treating empty voices as dirty', () => {
    const statuses = buildDirtyMeasureStatuses(scoreData, 1);

    expect(statuses).toHaveLength(2);
    expect(statuses[0]).toMatchObject({
      measureIndex: 0,
      measureNumber: 1,
      kind: 'underfill',
      actualTicks: 2,
      expectedTicks: 4,
      deltaTicks: -2,
    });
    expect(statuses[1]).toMatchObject({
      measureIndex: 1,
      measureNumber: 2,
      kind: 'overflow',
      actualTicks: 5,
      expectedTicks: 4,
      deltaTicks: 1,
    });
    expect(statuses[1].voices).toHaveLength(1);
  });
});
