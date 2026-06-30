import { describe, expect, it } from 'vitest';
import {
  getEntityDurationTicks,
  getMeasureDurationTicks,
  snapMeasureXToGridTick,
} from './measure-timeline';

describe('measure timeline view model', () => {
  it('derives event durations in ticks', () => {
    expect(getEntityDurationTicks({
      type: 'note',
      pitch: 'C4',
      duration: 'durationQuarter',
    }, 4)).toBe(4);
    expect(getEntityDurationTicks({
      type: 'rest',
      duration: 'durationHalf',
      dotted: true,
    }, 4)).toBe(12);
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
