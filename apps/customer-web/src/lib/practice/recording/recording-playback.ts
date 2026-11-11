import type { ReadyPerformanceRecording } from './recording-artifact';
import type { RecordingTimebase } from './recording-timebase';
import type { LocalMediaAsset } from '@/lib/practice/media/local-media-asset';

type RecordingPlaybackMedia =
  | Readonly<{ media: LocalMediaAsset; url?: never }>
  | Readonly<{ url: string; media?: never }>;

export type RecordingPlaybackSource = RecordingPlaybackMedia &
  Readonly<{ recordingTimebase?: RecordingTimebase }> &
  (Readonly<{ kind: 'AUDIO' }> | Readonly<{ kind: 'VIDEO' }>);

/** Borrows the recording; the player owns its independent media lease. */
export function recordingPlaybackSource(
  recording: ReadyPerformanceRecording | null,
): RecordingPlaybackSource | null {
  return recording
    ? Object.freeze({
        kind: recording.kind,
        media: recording.media,
        recordingTimebase: recording.timebase,
      })
    : null;
}
