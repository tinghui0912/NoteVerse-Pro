import { describe, expect, it } from 'vitest';
import type { ScoreData } from '@/types/score-types';
import {
  buildMeasureTimeline,
  findNearestTimelineAnchor,
  getMeasureDurationTicks,
  snapMeasureXToGridTick,
} from './measure-timeline';

const scoreData: ScoreData = {
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
                {
                  type: 'note',
                  pitch: 'C4',
                  duration: 'durationQuarter',
                  meta: {
                    id: 'v1-n1',
                    measureIndex: 0,
                    staveIndex: 0,
                    xmlVoice: 1,
                    entityIndex: 0,
                    startTick: 0,
                  },
                },
                {
                  type: 'note',
                  pitch: 'D4',
                  duration: 'durationQuarter',
                  meta: {
                    id: 'v1-n2',
                    measureIndex: 0,
                    staveIndex: 0,
                    xmlVoice: 1,
                    entityIndex: 1,
                    startTick: 4,
                  },
                },
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

describe('measure timeline view model', () => {
  it('builds anchors from populated voices', () => {
    const timeline = buildMeasureTimeline({
      scoreData,
      measureIndex: 0,
      staffIndex: 0,
      xmlVoices: [1],
      divisions: 4,
    });

    expect(timeline.anchors.map((anchor) => anchor.tick)).toEqual([0, 4, 8]);
  });

  it('can reuse populated voice anchors when the active voice is empty', () => {
    const activeVoiceTimeline = buildMeasureTimeline({
      scoreData,
      measureIndex: 0,
      staffIndex: 0,
      xmlVoices: [2],
      divisions: 4,
    });

    const measureTimeline = buildMeasureTimeline({
      scoreData,
      measureIndex: 0,
      staffIndex: 0,
      divisions: 4,
    });

    expect(activeVoiceTimeline.anchors.map((anchor) => anchor.tick)).toEqual([0]);
    expect(measureTimeline.anchors.map((anchor) => anchor.tick)).toEqual([0, 4, 8]);
  });

  it('finds the nearest insertion anchor', () => {
    const timeline = buildMeasureTimeline({
      scoreData,
      measureIndex: 0,
      staffIndex: 0,
      divisions: 4,
    });

    expect(findNearestTimelineAnchor(timeline, 5).tick).toBe(4);
    expect(findNearestTimelineAnchor(timeline, 7).tick).toBe(8);
  });

  it('snaps measure x positions to the nearest beat grid tick', () => {
    expect(getMeasureDurationTicks('4/4', 4)).toBe(16);

    expect(snapMeasureXToGridTick({
      clientX: 30,
      measureLeft: 0,
      measureWidth: 160,
      timeSignature: '4/4',
      divisions: 4,
    })).toEqual({ tick: 4, ratio: 0.25 });

    expect(snapMeasureXToGridTick({
      clientX: 160,
      measureLeft: 0,
      measureWidth: 160,
      timeSignature: '4/4',
      divisions: 4,
    })).toEqual({ tick: 16, ratio: 1 });
  });

  it('supports compound meters when deriving the measure grid', () => {
    expect(getMeasureDurationTicks('6/8', 4)).toBe(12);

    expect(snapMeasureXToGridTick({
      clientX: 42,
      measureLeft: 0,
      measureWidth: 120,
      timeSignature: '6/8',
      divisions: 4,
    })).toEqual({ tick: 4, ratio: 1 / 3 });
  });
});
