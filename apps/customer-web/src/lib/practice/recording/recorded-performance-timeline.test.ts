import { expect, it } from 'vitest';
import { recordedPerformanceScoreTick } from './recorded-performance-timeline';
import { recordedPerformanceFixture } from '@/lib/practice/__fixtures__/recorded-performance';
import { continuousPracticePlan } from '@/lib/practice/__fixtures__/practice-plan';
import { artifact } from "@/lib/practice/composite-video/__fixtures__/saved-take";
import { resolveCompositeVideoPlaybackPosition } from "@/lib/practice/composite-video/playback-position";
it.each(['SCORE', 'CUSTOM_FIXED_BPM'] as const)(
  'shares the %s timeline between replay and video across pauses, ranges and decoded-duration correction',
  (mode) => {
    const score = {
      ...artifact,
      scoreTempoSegments: [
        { startTick: 0, bpm: 120 },
        { startTick: 8, bpm: 60 },
      ],
    };
    const plan = continuousPracticePlan(score, {
      scope: { kind: 'RANGE', startGroupId: 'group-2', endGroupId: 'group-2' },
      tempoSelection: mode === 'SCORE' ? { mode } : { mode, bpm: 120 },
    });
    const base = recordedPerformanceFixture();
    const performance = recordedPerformanceFixture(plan, {
      ...base.recording,
      timebase: {
        nominalMediaDurationUs: 4000000,
        activeSegments: [
          {
            performanceStartUs: 0,
            performanceEndUs: 2000000,
            mediaStartUs: 0,
            mediaEndUs: 2000000,
          },
          {
            performanceStartUs: 3000000,
            performanceEndUs: 5000000,
            mediaStartUs: 2000000,
            mediaEndUs: 4000000,
          },
        ],
      },
    });
    const adapter = {
      getCursorTimelineEntryForTickRange: () => ({
        index: 1,
        tick: 4,
        endTick: 16,
        noteIds: ['note-2'],
      }),
      getPageWithElement: () => 1,
    };
    for (const mediaTimeMs of [0, 1000, 2000, 2001, 3000, 4000]) {
      const replayTick = recordedPerformanceScoreTick(
        performance,
        mediaTimeMs,
        5000,
      );
      const exported = resolveCompositeVideoPlaybackPosition({
        recordedPerformance: performance,
        adapter,
        mediaTimeMs,
        actualMediaDurationMs: 5000,
      });
      expect(exported?.scoreTick).toBe(replayTick);
    }
    expect(recordedPerformanceScoreTick(performance, 2500, 5000)).toBe(8);
    expect(
      recordedPerformanceScoreTick(performance, 2501, 5000),
    ).toBeGreaterThan(8);
  },
);
it('uses executed scope, tempo and recording timebase including actual-duration correction', () => {
  const plan = continuousPracticePlan(artifact, {
    scope: { kind: 'RANGE', startGroupId: 'group-2', endGroupId: 'group-2' },
    tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm: 120 },
  });
  const performance = recordedPerformanceFixture(plan, {
    ...recordedPerformanceFixture().recording,
    timebase: {
      nominalMediaDurationUs: 1000000,
      activeSegments: [
        {
          performanceStartUs: 0,
          performanceEndUs: 1000000,
          mediaStartUs: 0,
          mediaEndUs: 1000000,
        },
      ],
    },
  });
  expect(recordedPerformanceScoreTick(performance, 1000, 2000)).toBe(5);
  expect(recordedPerformanceScoreTick(performance, null)).toBeNull();
});
