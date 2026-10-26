import { assertRecordingTimebase, immutableRecordingTimebase, type RecordingTimebaseMapping } from './recording-timebase';

export type PerformanceRecording =
  | Readonly<{ status: 'NOT_RECORDED' }>
  | Readonly<{ status: 'UNAVAILABLE'; reason: string }>
  | Readonly<{ status: 'READY'; kind: 'AUDIO' | 'VIDEO'; blob: Blob; mimeType: string; durationMs: number; timebase: RecordingTimebaseMapping }>;

function assertPerformanceRecording(recording: PerformanceRecording): void {
  if (recording.status === 'NOT_RECORDED' && Object.keys(recording).join() === 'status') return;
  if (recording.status === 'UNAVAILABLE' && typeof recording.reason === 'string' && recording.reason.length > 0
    && Object.keys(recording).sort().join() === 'reason,status') return;
  if (recording.status !== 'READY' || !['AUDIO', 'VIDEO'].includes(recording.kind) || !(recording.blob instanceof Blob)
    || recording.blob.size <= 0 || typeof recording.mimeType !== 'string' || !recording.mimeType
    || !Number.isFinite(recording.durationMs) || recording.durationMs < 0
    || Object.keys(recording).sort().join() !== 'blob,durationMs,kind,mimeType,status,timebase') {
    throw new Error('Performance recording is invalid.');
  }
  assertRecordingTimebase(recording.timebase);
}
export function createPerformanceRecording(recording: PerformanceRecording): PerformanceRecording {
  assertPerformanceRecording(recording);
  return recording.status === 'READY'
    ? Object.freeze({ ...recording, timebase: immutableRecordingTimebase(recording.timebase) })
    : Object.freeze({ ...recording });
}
