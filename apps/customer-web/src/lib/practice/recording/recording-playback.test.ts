import { expect, it, vi } from 'vitest';
import { recordingPlaybackSource } from './recording-playback';
import type { ReadyPerformanceRecording } from './recording-artifact';
import { localMediaAssetFixture } from '@/lib/practice/__fixtures__/local-media-asset';

it.each(['AUDIO', 'VIDEO'] as const)(
  'projects %s recording without acquiring bytes or execution semantics',
  (kind) => {
    const backing = localMediaAssetFixture(new Blob(['raw recording']));
    const retain = vi.fn(() => backing.retain());
    const media = { ...backing, retain };
    const timebase = {
      nominalMediaDurationUs: 1000000,
      activeSegments: [
        {
          performanceStartUs: 0,
          performanceEndUs: 1000000,
          mediaStartUs: 0,
          mediaEndUs: 1000000,
        },
      ],
    };
    const recording: ReadyPerformanceRecording = {
      status: 'READY',
      kind,
      media,
      mimeType: kind === 'AUDIO' ? 'audio/webm' : 'video/webm',
      timebase,
    };
    const source = recordingPlaybackSource(recording)!;
    expect(Object.keys(source).sort()).toEqual([
      'kind',
      'media',
      'recordingTimebase',
    ]);
    expect(source.kind).toBe(kind);
    expect(source.media).toBe(media);
    expect(source.recordingTimebase).toBe(timebase);
    expect(Object.isFrozen(source)).toBe(true);
    expect(retain).not.toHaveBeenCalled();
  },
);
it('has no source without a ready recording', () => {
  expect(recordingPlaybackSource(null)).toBeNull();
});
