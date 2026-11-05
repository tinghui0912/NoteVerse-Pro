import { recordingResourceFixture } from '@/lib/practice/__fixtures__/recording-sink';
import { expect, it } from 'vitest';
import { reviewReplay, reviewReplayScoreTick } from './review-replay';
import type { PerformanceRecording } from '@/lib/practice/recording/recording-artifact';
const recording: PerformanceRecording = { resource: recordingResourceFixture(), status: 'READY', kind: 'AUDIO', blob: new Blob(['audio']), mimeType: 'audio/webm', durationMs: 1000,
  timebase: { nominalMediaDurationMs: 1000, activeSegments: [{ perfStartMs: 0, perfEndMs: 1000, mediaStartMs: 0, mediaEndMs: 1000 }] } };
it.each(['AUDIO', 'VIDEO'] as const)('builds a %s replay without cloning media or inventing a recording', kind => {
  const ready = { ...recording, kind } as PerformanceRecording;
  expect(reviewReplay(ready)).toMatchObject({ kind: kind + '_RECORDING', blob: recording.status === 'READY' ? recording.blob : null });
  expect(reviewReplay({ status: 'NOT_RECORDED' })).toBeNull(); expect(reviewReplay({ status: 'UNAVAILABLE', reason: 'denied' })).toBeNull();
});
it('uses the recording timebase and selected scope to map media to musical tick', () => {
  const input = { recording, mediaTimeMs: 1000, actualMediaDurationMs: 2000,
    scope: { kind: 'FULL' as const, startIndex: 0, endIndex: 0, startTick: 4, terminalTick: 8 },
    tempoPlan: { selection: { mode: 'SCORE' as const }, segments: [{ startTick: 0, bpm: 120, source: 'MUSICXML' as const }] }, scoreEndTick: 8, ticksPerQuarter: 1 };
  expect(reviewReplayScoreTick(input)).toBe(5);
  expect(reviewReplayScoreTick({ ...input, mediaTimeMs: null })).toBeNull();
});
