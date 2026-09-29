import { describe, expect, it } from 'vitest';
import {
  mediaTimeToPerformanceTimeMs,
  completedPerformanceStore,
  type CompletedPerformance,
} from './completed-performance';

describe('CompletedPerformanceStore', () => {
  it('stores, retrieves, clears and notifies subscribers of draft', () => {
    completedPerformanceStore.clearPerformance();
    expect(completedPerformanceStore.getPerformance()).toBeNull();

    const notifications: (CompletedPerformance | null)[] = [];
    const unsubscribe = completedPerformanceStore.subscribe((draft) => {
      notifications.push(draft);
    });

    const mockDraft: CompletedPerformance = {
      localSessionId: 'sess-123',
      scoreId: 'score-abc',
      revisionId: 'rev-1',
      artifactId: 'art-1',
      scope: {
        kind: 'FULL',
        startIndex: 0,
        endIndex: 2,
        startBeat: 0,
        terminalBeat: 8,
      },
      tempoPlan: {
        selection: { mode: 'CUSTOM_FIXED_BPM', bpm: 90 },
        segments: [{ startBeat: 0, bpm: 90, source: 'CUSTOM' }],
      },
      inputSource: 'MICROPHONE',
      activeElapsedMs: 4000,
      evaluation: {
        outcomes: [],
      },
      media: {
        status: 'READY',
        kind: 'AUDIO',
        blob: new Blob(['audio-data'], { type: 'audio/webm' }),
        mimeType: 'audio/webm',
        durationMs: 4000,
      },
      recordingTimebase: {
        activeSegments: [{ perfStartMs: 0, perfEndMs: 4000, mediaStartMs: 0, mediaEndMs: 4000 }],
        nominalMediaDurationMs: 4000,
      },
      completedAt: '2026-09-20T12:00:00.000Z',
    };

    completedPerformanceStore.setPerformance(mockDraft);
    expect(completedPerformanceStore.getPerformance()).toEqual(mockDraft);

    completedPerformanceStore.clearPerformance();
    expect(completedPerformanceStore.getPerformance()).toBeNull();

    unsubscribe();
    expect(notifications).toEqual([null, mockDraft, null]);
  });

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
});
