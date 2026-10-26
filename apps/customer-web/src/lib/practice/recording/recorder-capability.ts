import type { PracticeRecordingMode } from './recording-mode';

export function recordingOptions(mode: Exclude<PracticeRecordingMode, 'OFF'>): MediaRecorderOptions | undefined {
  if (typeof MediaRecorder === 'undefined') throw new Error('MEDIA_RECORDER_UNSUPPORTED');
  if (mode === 'AUDIO') return undefined;
  if (typeof MediaRecorder.isTypeSupported !== 'function') throw new Error('VIDEO_RECORDER_UNSUPPORTED');
  const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
    .find(candidate => MediaRecorder.isTypeSupported(candidate));
  if (!mimeType) throw new Error('VIDEO_RECORDER_UNSUPPORTED');
  return { mimeType };
}

/** A capability probe owns no recording artifact or retained chunks. */
export async function probeRecording(mode: Exclude<PracticeRecordingMode, 'OFF'>, stream: MediaStream): Promise<void> {
  if (!stream.getAudioTracks().some(track => track.readyState === 'live')
    || (mode === 'VIDEO' && !stream.getVideoTracks().some(track => track.readyState === 'live'))) {
    throw new Error('RECORDING_TRACKS_UNAVAILABLE');
  }
  const recorder = new MediaRecorder(stream, recordingOptions(mode));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('RECORDING_PROBE_TIMEOUT')), 5000);
    const finish = (error?: Error) => {
      clearTimeout(timer); recorder.onstop = null; recorder.onerror = null; recorder.ondataavailable = null;
      try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* Teardown preserves probe error. */ }
      if (error) reject(error); else resolve();
    };
    recorder.onerror = () => finish(new Error('RECORDING_PROBE_FAILED'));
    recorder.onstop = () => finish();
    try { recorder.start(); recorder.stop(); } catch { finish(new Error('RECORDING_PROBE_FAILED')); }
  });
}
