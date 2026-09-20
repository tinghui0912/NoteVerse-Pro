import { describe, expect, it } from 'vitest';
import {
  mediaTimeToPerformanceTimeMs,
  performanceReviewDraftStore,
  type PerformanceReviewDraft,
} from './performance-review-draft';

describe('PerformanceReviewDraftStore', () => {
  it('stores, retrieves, clears and notifies subscribers of draft', () => {
    performanceReviewDraftStore.clearDraft();
    expect(performanceReviewDraftStore.getDraft()).toBeNull();

    const notifications: (PerformanceReviewDraft | null)[] = [];
    const unsubscribe = performanceReviewDraftStore.subscribe((draft) => {
      notifications.push(draft);
    });

    const mockDraft: PerformanceReviewDraft = {
      localSessionId: 'sess-123',
      scoreId: 'score-abc',
      revisionId: 'rev-1',
      artifactId: 'art-1',
      scope: {
        startIndex: 0,
        endIndex: 2,
        startBeat: 0,
        terminalBeat: 8,
      },
      tempoPlan: {
        selection: { mode: 'CUSTOM_FIXED_BPM', bpm: 90 },
        segments: [{ startBeat: 0, bpm: 90, source: 'CUSTOM' }],
      },
      performanceSnapshot: {
        localSessionId: 'sess-123',
        scoreId: 'score-abc',
        revisionId: 'rev-1',
        artifactId: 'art-1',
        mode: 'CONTINUOUS_PLAY',
        inputSource: 'MICROPHONE',
        tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm: 90 },
        metronomeEnabled: false,
        lifecycleState: 'ENDED',
        completionReason: 'SCOPE_COMPLETED',
        version: { schemaVersion: 1, runtimeVersion: '1.0.0' },
        createdAtMs: 1000,
        updatedAtMs: 5000,
        performance: {
          state: 'ENDED',
          stateBeforePause: 'RUNNING',
          resolvedTempoPlan: {
            selection: { mode: 'CUSTOM_FIXED_BPM', bpm: 90 },
            segments: [{ startBeat: 0, bpm: 90, source: 'CUSTOM' }],
          },
          scopeStartBeat: 0,
          scopeTerminalBeat: 8,
          activeElapsedMs: 4000,
          countInMs: 2000,
          countInBeats: 4,
          countInPulses: 4,
          observations: [],
          outcomes: [],
        },
      },
      audio: {
        status: 'READY',
        blob: new Blob(['audio-data'], { type: 'audio/webm' }),
        mimeType: 'audio/webm',
        durationMs: 4000,
      },
      recordingTimebase: {
        recordingStartPerfTimeMs: 0,
        recordingEndPerfTimeMs: 4000,
        activeSegments: [{ perfStartMs: 0, perfEndMs: 4000, mediaStartMs: 0, mediaEndMs: 4000 }],
        nominalMediaDurationMs: 4000,
      },
      replayTiming: {
        scopeStartBeat: 0,
        scopeStartMs: 0,
        nominalDurationMs: 5333,
      },
      completedAt: '2026-09-20T12:00:00.000Z',
    };

    performanceReviewDraftStore.setDraft(mockDraft);
    expect(performanceReviewDraftStore.getDraft()).toEqual(mockDraft);

    performanceReviewDraftStore.clearDraft();
    expect(performanceReviewDraftStore.getDraft()).toBeNull();

    unsubscribe();
    expect(notifications).toEqual([null, mockDraft, null]);
  });

  describe('mediaTimeToPerformanceTimeMs', () => {
    it('returns null if timebase is missing or has no active segments', () => {
      expect(mediaTimeToPerformanceTimeMs(1000, null)).toBeNull();
      expect(
        mediaTimeToPerformanceTimeMs(1000, {
          recordingStartPerfTimeMs: 0,
          recordingEndPerfTimeMs: 0,
          activeSegments: [],
          nominalMediaDurationMs: 0,
        })
      ).toBeNull();
    });

    it('correctly maps time with start offset in a single active segment', () => {
      // Practice started recording at performanceTimeMs = 50ms
      const timebase = {
        recordingStartPerfTimeMs: 50,
        recordingEndPerfTimeMs: 5050,
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
        recordingStartPerfTimeMs: 0,
        recordingEndPerfTimeMs: 7000,
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

    it('scales proportionally when actual decoded media duration differs slightly from nominal', () => {
      // Nominal duration 5000ms, but actual decoded media is 5050ms
      const timebase = {
        recordingStartPerfTimeMs: 0,
        recordingEndPerfTimeMs: 5000,
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
