import { describe, expect, it } from 'vitest';

import type { MeasureId, Rational, StaffId, VoiceId } from './model';
import { createRhythmicGridResolution } from './rhythmic-input';
import {
  createRhythmicLayoutMap,
  getLayoutPointAtPosition,
  resolveNearestLayoutPoint,
} from './rhythmic-layout-map';

const measureId = 'measure-1' as MeasureId;
const staffId = 'staff-1' as StaffId;
const voiceId = 'voice-1' as VoiceId;
const measureDuration: Rational = { numerator: 4, denominator: 1 };
const quarterGrid = createRhythmicGridResolution({ numerator: 1, denominator: 1 });
const eighthGrid = createRhythmicGridResolution({ numerator: 1, denominator: 2 });

describe('rhythmic layout map', () => {
  it('maps legal rhythmic positions to non-linear rendered x coordinates', () => {
    const layoutMap = createRhythmicLayoutMap({
      measureId,
      staffId,
      voiceId,
      measureDuration,
      grid: quarterGrid,
      xLeft: 10,
      xRight: 260,
      anchors: [
        {
          position: {
            measureId,
            offset: { numerator: 1, denominator: 1 },
          },
          x: 80,
        },
        {
          position: {
            measureId,
            offset: { numerator: 2, denominator: 1 },
          },
          x: 130,
        },
        {
          position: {
            measureId,
            offset: { numerator: 3, denominator: 1 },
          },
          x: 220,
        },
      ],
    });

    expect(layoutMap.points.map((point) => ({
      offset: point.gridPosition.position.offset,
      x: point.x,
    }))).toEqual([
      { offset: { numerator: 0, denominator: 1 }, x: 10 },
      { offset: { numerator: 1, denominator: 1 }, x: 80 },
      { offset: { numerator: 2, denominator: 1 }, x: 130 },
      { offset: { numerator: 3, denominator: 1 }, x: 220 },
      { offset: { numerator: 4, denominator: 1 }, x: 260 },
    ]);
  });

  it('interpolates missing grid positions between rendered anchors', () => {
    const layoutMap = createRhythmicLayoutMap({
      measureId,
      staffId,
      voiceId,
      measureDuration,
      grid: eighthGrid,
      xLeft: 10,
      xRight: 260,
      anchors: [
        {
          position: {
            measureId,
            offset: { numerator: 1, denominator: 1 },
          },
          x: 80,
        },
        {
          position: {
            measureId,
            offset: { numerator: 2, denominator: 1 },
          },
          x: 130,
        },
        {
          position: {
            measureId,
            offset: { numerator: 3, denominator: 1 },
          },
          x: 220,
        },
      ],
    });

    expect(getLayoutPointAtPosition(layoutMap, {
      measureId,
      offset: { numerator: 3, denominator: 2 },
    })).toMatchObject({
      gridPosition: {
        index: 3,
        position: {
          offset: { numerator: 3, denominator: 2 },
        },
      },
      x: 105,
    });
  });

  it('resolves pointer x to the nearest legal rhythmic position with forward ties', () => {
    const layoutMap = createRhythmicLayoutMap({
      measureId,
      staffId,
      voiceId,
      measureDuration,
      grid: quarterGrid,
      xLeft: 10,
      xRight: 260,
      anchors: [
        {
          position: {
            measureId,
            offset: { numerator: 1, denominator: 1 },
          },
          x: 80,
        },
      ],
    });

    expect(resolveNearestLayoutPoint({
      layoutMap,
      clientX: 79,
    }).gridPosition.position.offset).toEqual({ numerator: 1, denominator: 1 });

    expect(resolveNearestLayoutPoint({
      layoutMap,
      clientX: 45,
    }).gridPosition.position.offset).toEqual({ numerator: 1, denominator: 1 });
  });

  it('clamps pointer x to rendered measure boundaries', () => {
    const layoutMap = createRhythmicLayoutMap({
      measureId,
      staffId,
      voiceId,
      measureDuration,
      grid: quarterGrid,
      xLeft: 10,
      xRight: 260,
    });

    expect(resolveNearestLayoutPoint({
      layoutMap,
      clientX: -100,
    }).gridPosition.position.offset).toEqual({ numerator: 0, denominator: 1 });

    expect(resolveNearestLayoutPoint({
      layoutMap,
      clientX: 999,
    }).gridPosition.position.offset).toEqual(measureDuration);
  });

  it('rejects invalid geometry and out-of-measure anchors', () => {
    expect(() => createRhythmicLayoutMap({
      measureId,
      staffId,
      voiceId,
      measureDuration,
      grid: quarterGrid,
      xLeft: 10,
      xRight: 10,
    })).toThrow('Layout right x must be greater than left x.');

    expect(() => createRhythmicLayoutMap({
      measureId,
      staffId,
      voiceId,
      measureDuration,
      grid: quarterGrid,
      xLeft: 10,
      xRight: 260,
      anchors: [
        {
          position: {
            measureId: 'other-measure' as MeasureId,
            offset: { numerator: 1, denominator: 1 },
          },
          x: 80,
        },
      ],
    })).toThrow('Rhythmic layout anchors must belong to the layout measure.');

    expect(() => createRhythmicLayoutMap({
      measureId,
      staffId,
      voiceId,
      measureDuration,
      grid: quarterGrid,
      xLeft: 10,
      xRight: 260,
      anchors: [
        {
          position: {
            measureId,
            offset: { numerator: 5, denominator: 1 },
          },
          x: 300,
        },
      ],
    })).toThrow('Rhythmic layout anchors must be inside the measure.');
  });
});
