import { RecordingFailure } from '@/lib/practice/failure/causal-failure';
import { recordingBrowserFailure } from '@/lib/practice/failure/browser-failures';
import type { PracticeRecordingMode } from './recording-mode';

export function recordingOptions(mode: Exclude<PracticeRecordingMode, 'OFF'>): MediaRecorderOptions | undefined {
  if (typeof MediaRecorder === 'undefined') throw new RecordingFailure('MEDIA_RECORDER_UNSUPPORTED');
  if (mode === 'AUDIO') return undefined;
  if (typeof MediaRecorder.isTypeSupported !== 'function') throw new RecordingFailure('VIDEO_RECORDER_UNSUPPORTED');
  const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
    .find(candidate => MediaRecorder.isTypeSupported(candidate));
  if (!mimeType) throw new RecordingFailure('VIDEO_RECORDER_UNSUPPORTED');
  return { mimeType };
}

/** A capability probe owns no recording artifact or retained chunks. */
export async function probeRecording(mode: Exclude<PracticeRecordingMode, 'OFF'>, stream: MediaStream): Promise<void> {
  if (!stream.getAudioTracks().some(track => track.readyState === 'live')
    || (mode === 'VIDEO' && !stream.getVideoTracks().some(track => track.readyState === 'live'))) {
    throw new RecordingFailure('RECORDING_TRACKS_UNAVAILABLE');
  }
  let recorder: MediaRecorder;
  try { recorder = new MediaRecorder(stream, recordingOptions(mode)); } catch (cause) { throw recordingBrowserFailure(cause); }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => finish(new RecordingFailure('RECORDING_PROBE_TIMEOUT')), 5000);
    const finish = (error?: Error) => {
      clearTimeout(timer); recorder.onstop = null; recorder.onerror = null; recorder.ondataavailable = null;
      try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* Teardown preserves probe error. */ }
      if (error) reject(error); else resolve();
    };
    recorder.onerror = () => finish(new RecordingFailure('RECORDING_PROBE_FAILED'));
    recorder.onstop = () => finish();
    try { recorder.start(); recorder.stop(); } catch { finish(new RecordingFailure('RECORDING_PROBE_FAILED')); }
  });
}
