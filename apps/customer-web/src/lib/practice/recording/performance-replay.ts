import type { RecordedPerformance } from './recorded-performance';
import type { RecordingTimebase } from './recording-timebase';
import type { LocalMediaAsset } from '@/lib/practice/media/local-media-asset';
type PerformanceReplayTimebase = {
  version: 1;
  speedRatio: number;
};

type ReplaySource =
  | { media: LocalMediaAsset; url?: never }
  | { url: string; media?: never };

export type PlayablePerformanceReplay =
  | (ReplaySource & {
      kind: 'AUDIO_RECORDING';
      contentType: string;
      byteSize?: number;
      recordingTimebase?: RecordingTimebase;
      timebase?: PerformanceReplayTimebase;
    })
  | (ReplaySource & {
      kind: 'VIDEO_RECORDING';
      contentType: string;
      byteSize?: number;
      recordingTimebase?: RecordingTimebase;
      timebase?: PerformanceReplayTimebase;
    });

export function recordedPerformanceReplay(
  performance: RecordedPerformance | null,
): PlayablePerformanceReplay | null {
  if (!performance) return null;
  const { recording } = performance;
  return {
    kind: recording.kind === 'VIDEO' ? 'VIDEO_RECORDING' : 'AUDIO_RECORDING',
    media: recording.media,
    contentType: recording.mimeType,
    byteSize: recording.media.byteSize,
    recordingTimebase: recording.timebase,
  };
}
