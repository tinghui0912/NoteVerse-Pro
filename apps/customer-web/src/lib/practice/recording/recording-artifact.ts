import {
  assertRecordingTimebase,
  decodeRecordingTimebase,
  type RecordingTimebase,
} from './recording-timebase';
import {
  isAdmittedRecordingMime,
  type RecordingMediaKind,
} from './media-admission';
import type { LocalMediaAsset } from '@/lib/practice/media/local-media-asset';

export type PerformanceRecording =
  | Readonly<{ status: 'NOT_RECORDED' }>
  | Readonly<{ status: 'UNAVAILABLE'; reason: string }>
  | Readonly<{
      status: 'READY';
      kind: RecordingMediaKind;
      media: LocalMediaAsset;
      mimeType: string;
      timebase: RecordingTimebase;
    }>;

export type ReadyPerformanceRecording = Extract<
  PerformanceRecording,
  { status: 'READY' }
>;

export function assertPerformanceRecording(
  recording: PerformanceRecording,
): void {
  if (
    recording.status === 'NOT_RECORDED' &&
    Object.keys(recording).join() === 'status'
  )
    return;
  if (
    recording.status === 'UNAVAILABLE' &&
    typeof recording.reason === 'string' &&
    recording.reason.length > 0 &&
    Object.keys(recording).sort().join() === 'reason,status'
  )
    return;
  if (
    recording.status !== 'READY' ||
    !['AUDIO', 'VIDEO'].includes(recording.kind) ||
    !recording.media ||
    !(recording.media.blob instanceof Blob) ||
    recording.media.byteSize !== recording.media.blob.size ||
    recording.media.byteSize <= 0 ||
    typeof recording.mimeType !== 'string' ||
    !recording.mimeType ||
    !isAdmittedRecordingMime(recording.kind, recording.mimeType) ||
    typeof recording.media.retain !== 'function' ||
    typeof recording.media.release !== 'function' ||
    Object.keys(recording).sort().join() !==
      'kind,media,mimeType,status,timebase'
  ) {
    throw new Error('Performance recording is invalid.');
  }
  assertRecordingTimebase(recording.timebase);
}
export function createPerformanceRecording(
  recording: PerformanceRecording,
): PerformanceRecording {
  assertPerformanceRecording(recording);
  return recording.status === 'READY'
    ? Object.freeze({
        ...recording,
        timebase: decodeRecordingTimebase(recording.timebase),
      })
    : Object.freeze({ ...recording });
}
