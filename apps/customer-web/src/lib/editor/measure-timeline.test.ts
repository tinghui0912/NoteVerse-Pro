import { describe, expect, it } from 'vitest';
import {
  getEntityDurationTicks,
  getMeasureDurationTicks,
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

  it('derives measure duration in ticks', () => {
    expect(getMeasureDurationTicks('4/4', 4)).toBe(16);
  });

  it('supports compound meters when deriving measure duration', () => {
    expect(getMeasureDurationTicks('6/8', 4)).toBe(12);
  });
});
