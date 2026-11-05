import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertRecordingTimebase,
  decodeRecordingTimebase,
  millisecondsToMicroseconds,
  microsecondsToMilliseconds,
  mediaTimeUsToPerformanceTimeUs,
  replayMediaTimeMsToPerformanceTimeMs,
} from './recording-timebase';

const cases = JSON.parse(
  readFileSync(
    new URL(
      '../../../../../../contracts/practice/recording-timebase-cases.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { name: string; valid: boolean; value: unknown }[];

describe('shared RecordingTimebase conformance', () => {
  it.each(cases)('$name: valid=$valid', ({ value, valid }) => {
    if (valid) expect(decodeRecordingTimebase(value)).toEqual(value);
    else expect(() => decodeRecordingTimebase(value)).toThrow();
  });
  it.each([NaN, Infinity, -Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects runtime coordinate %s',
    (coordinate) => {
      expect(() =>
        assertRecordingTimebase({
          nominalMediaDurationUs: 1,
          activeSegments: [
            {
              performanceStartUs: coordinate,
              performanceEndUs: 1,
              mediaStartUs: 0,
              mediaEndUs: 1,
            },
          ],
        }),
      ).toThrow();
    },
  );
  it('owns immutable segment shells without freezing the builder', () => {
    const builder = {
      nominalMediaDurationUs: 37,
      activeSegments: [
        {
          performanceStartUs: 13,
          performanceEndUs: 50,
          mediaStartUs: 0,
          mediaEndUs: 37,
        },
      ],
    };
    const value = decodeRecordingTimebase(builder);
    expect(Object.isFrozen(builder)).toBe(false);
    builder.activeSegments.length = 0;
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.activeSegments)).toBe(true);
    expect(Object.isFrozen(value.activeSegments[0])).toBe(true);
    expect(mediaTimeUsToPerformanceTimeUs(17, value)).toBe(30);
  });
});

describe('runtime conversion boundary', () => {
  it.each([
    [0, 0],
    [0.00049, 0],
    [0.0005, 1],
    [1.2345, 1235],
    [1.2344, 1234],
  ])('rounds %s ms once to %s us (ties upward)', (ms, us) => {
    expect(millisecondsToMicroseconds(ms)).toBe(us);
    expect(microsecondsToMilliseconds(us)).toBe(us / 1000);
  });
  it.each([-1, NaN, Infinity, Number.MAX_SAFE_INTEGER])(
    'rejects unsafe runtime milliseconds %s',
    (ms) => expect(() => millisecondsToMicroseconds(ms)).toThrow(),
  );
  it.each([-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid integer microseconds %s',
    (us) => expect(() => microsecondsToMilliseconds(us)).toThrow(),
  );
});

describe('integer media mapping', () => {
  const timebase = decodeRecordingTimebase(
    cases.find((c) => c.name === 'pause_resume_performance_gap')!.value,
  );
  it('preserves exact pause gaps and preceding endpoint ownership', () => {
    expect(mediaTimeUsToPerformanceTimeUs(0, timebase)).toBe(100000);
    expect(mediaTimeUsToPerformanceTimeUs(1000000, timebase)).toBe(1100000);
    expect(mediaTimeUsToPerformanceTimeUs(1000001, timebase)).toBe(3100001);
    expect(mediaTimeUsToPerformanceTimeUs(2000000, timebase)).toBe(4100000);
    expect(replayMediaTimeMsToPerformanceTimeMs(1000.001, timebase)).toBe(
      3100.001,
    );
    expect(replayMediaTimeMsToPerformanceTimeMs(0, null)).toBeNull();
  });
  it('keeps a large performance origin exact without an unsafe intermediate sum', () => {
    const end = Number.MAX_SAFE_INTEGER;
    const value = decodeRecordingTimebase({
      nominalMediaDurationUs: 6,
      activeSegments: [
        {
          performanceStartUs: end - 6,
          performanceEndUs: end - 2,
          mediaStartUs: 0,
          mediaEndUs: 4,
        },
        {
          performanceStartUs: end - 2,
          performanceEndUs: end,
          mediaStartUs: 4,
          mediaEndUs: 6,
        },
      ],
    });
    expect(mediaTimeUsToPerformanceTimeUs(5, value)).toBe(end - 1);
  });
  it.each([2000000, 2020000, 1980000])(
    'scales decoded duration %s deterministically',
    (actual) => {
      expect(mediaTimeUsToPerformanceTimeUs(0, timebase, actual)).toBe(100000);
      expect(mediaTimeUsToPerformanceTimeUs(actual / 4, timebase, actual)).toBe(
        600000,
      );
      expect(mediaTimeUsToPerformanceTimeUs(actual / 2, timebase, actual)).toBe(
        1100000,
      );
      expect(mediaTimeUsToPerformanceTimeUs(actual, timebase, actual)).toBe(
        4100000,
      );
      expect(timebase.nominalMediaDurationUs).toBe(2000000);
    },
  );
  it.each([
    [43200000000, 21599999999],
    [Number.MAX_SAFE_INTEGER, 4503599627370496],
  ])('keeps products exact at duration %s us', (duration, midpoint) => {
    const value = decodeRecordingTimebase({
      nominalMediaDurationUs: duration,
      activeSegments: [
        {
          performanceStartUs: 0,
          performanceEndUs: duration,
          mediaStartUs: 0,
          mediaEndUs: duration,
        },
      ],
    });
    const actual = duration - 1;
    expect(mediaTimeUsToPerformanceTimeUs(actual, value, actual)).toBe(
      duration,
    );
    expect(
      mediaTimeUsToPerformanceTimeUs(Math.floor(actual / 2), value, actual),
    ).toBe(midpoint);
  });
});
