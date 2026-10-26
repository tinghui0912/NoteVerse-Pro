import { describe, expect, it } from 'vitest';
import { mediaTimeToPerformanceTimeMs, assertRecordingTimebase, immutableRecordingTimebase } from './recording-timebase';
describe('mediaTimeToPerformanceTimeMs', () => {
    it('returns null if timebase is missing or has no active segments', () => {
      expect(mediaTimeToPerformanceTimeMs(1000, null)).toBeNull();
      expect(
        mediaTimeToPerformanceTimeMs(1000, {
          activeSegments: [],
          nominalMediaDurationMs: 0,
        })
      ).toBeNull();
    });

    it('correctly maps time with start offset in a single active segment', () => {
      // Practice started recording at performanceTimeMs = 50ms
      const timebase = {
        activeSegments: [{ perfStartMs: 50, perfEndMs: 5050, mediaStartMs: 0, mediaEndMs: 5000 }],
        nominalMediaDurationMs: 5000,
      };

      // At media start (0ms) -> maps to 50ms performance time
      expect(mediaTimeToPerformanceTimeMs(0, timebase)).toBe(50);
      // At media 1000ms -> maps to 1050ms
      expect(mediaTimeToPerformanceTimeMs(1000, timebase)).toBe(1050);
      // Beyond media end (6000ms) -> clamps to 5050ms
      expect(mediaTimeToPerformanceTimeMs(6000, timebase)).toBe(5050);
    });

    it('correctly maps time across pauses and resumes', () => {
      // Segment 1: media 0-3000ms -> perf 0-3000ms
      // Paused for 10s (not in media)
      // Segment 2: media 3000-7000ms -> perf 3000-7000ms
      const timebase = {
        activeSegments: [
          { perfStartMs: 0, perfEndMs: 3000, mediaStartMs: 0, mediaEndMs: 3000 },
          { perfStartMs: 3000, perfEndMs: 7000, mediaStartMs: 3000, mediaEndMs: 7000 },
        ],
        nominalMediaDurationMs: 7000,
      };

      expect(mediaTimeToPerformanceTimeMs(1500, timebase)).toBe(1500);
      expect(mediaTimeToPerformanceTimeMs(3000, timebase)).toBe(3000);
      expect(mediaTimeToPerformanceTimeMs(5000, timebase)).toBe(5000);
      expect(mediaTimeToPerformanceTimeMs(7000, timebase)).toBe(7000);
    });

    it('fails closed when media segments contain an undefined gap', () => {
      const timebase = {
        activeSegments: [
          { perfStartMs: 0, perfEndMs: 3000, mediaStartMs: 0, mediaEndMs: 3000 },
          { perfStartMs: 5000, perfEndMs: 7000, mediaStartMs: 4000, mediaEndMs: 6000 },
        ],
        nominalMediaDurationMs: 6000,
      };

      expect(mediaTimeToPerformanceTimeMs(3500, timebase)).toBeNull();
    });

    it('scales proportionally when actual decoded media duration differs slightly from nominal', () => {
      // Nominal duration 5000ms, but actual decoded media is 5050ms
      const timebase = {
        activeSegments: [{ perfStartMs: 0, perfEndMs: 5000, mediaStartMs: 0, mediaEndMs: 5000 }],
        nominalMediaDurationMs: 5000,
      };

      // At actual media end (5050ms), maps to nominal end 5000ms
      expect(mediaTimeToPerformanceTimeMs(5050, timebase, 5050)).toBe(5000);
      // At halfway (2525ms), maps to 2500ms
      expect(mediaTimeToPerformanceTimeMs(2525, timebase, 5050)).toBe(2500);
    });
  });

describe('READY recording timebase integrity', () => {
  const mapping = () => ({ nominalMediaDurationMs: 1000, activeSegments: [
    { perfStartMs: 0, perfEndMs: 500, mediaStartMs: 0, mediaEndMs: 500 },
    { perfStartMs: 900, perfEndMs: 1400, mediaStartMs: 500, mediaEndMs: 1000 },
  ] });
  it('accepts ordered pause/resume, numeric duration rounding and zero-duration boundaries', () => {
    expect(() => assertRecordingTimebase(mapping())).not.toThrow();
    expect(() => assertRecordingTimebase({ ...mapping(), nominalMediaDurationMs: 1000.5 })).not.toThrow();
    expect(() => assertRecordingTimebase({ nominalMediaDurationMs: 0, activeSegments: [] })).not.toThrow();
    expect(() => assertRecordingTimebase({ nominalMediaDurationMs: 0, activeSegments: [{ perfStartMs: 0, perfEndMs: 0, mediaStartMs: 0, mediaEndMs: 0 }] })).not.toThrow();
  });
  it.each([
    ['nonfinite', (m: ReturnType<typeof mapping>) => { m.activeSegments[0].perfStartMs = NaN; }],
    ['negative', (m: ReturnType<typeof mapping>) => { m.activeSegments[0].mediaStartMs = -1; }],
    ['reversed performance', (m: ReturnType<typeof mapping>) => { m.activeSegments[0].perfEndMs = -1; }],
    ['reversed media', (m: ReturnType<typeof mapping>) => { m.activeSegments[1].mediaEndMs = 499; }],
    ['performance overlap', (m: ReturnType<typeof mapping>) => { m.activeSegments[1].perfStartMs = 499; }],
    ['media gap', (m: ReturnType<typeof mapping>) => { m.activeSegments[1].mediaStartMs = 502; }],
    ['nonzero first media start', (m: ReturnType<typeof mapping>) => { m.activeSegments[0].mediaStartMs = 1; }],
    ['nominal duration', (m: ReturnType<typeof mapping>) => { m.nominalMediaDurationMs = 1002; }],
  ] as const)('rejects %s', (_name, corrupt) => { const value = mapping(); corrupt(value); expect(() => assertRecordingTimebase(value)).toThrow(); });
  it('copies/freezes the builder and preserves synchronization after builder mutation', () => {
    const builder = mapping(), saved = immutableRecordingTimebase(builder);
    builder.activeSegments[0].perfEndMs = 100; builder.activeSegments.length = 0;
    expect(Object.isFrozen(saved)).toBe(true); expect(Object.isFrozen(saved.activeSegments)).toBe(true);
    expect(Object.isFrozen(saved.activeSegments[0])).toBe(true);
    expect(mediaTimeToPerformanceTimeMs(750, saved)).toBe(1150);
  });
});
