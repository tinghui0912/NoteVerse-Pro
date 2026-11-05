import { RecordingFailure } from '@/lib/practice/failure/causal-failure';
import { recordingBrowserFailure } from '@/lib/practice/failure/browser-failures';
import type { PracticeRecordingMode } from './recording-mode';
import { isArchiveableCaptureMime, VIDEO_CAPTURE_MIME_CANDIDATES } from './media-policy';
import { openOpfsRecordingSink } from './opfs-recording-sink';
import type { OwnedMediaHandle } from './owned-media';
import type { RecordingSinkFactory } from './recording-sink';

export function recordingOptions(mode: Exclude<PracticeRecordingMode, 'OFF'>): MediaRecorderOptions | undefined {
  if (typeof MediaRecorder === 'undefined') throw new RecordingFailure('MEDIA_RECORDER_UNSUPPORTED');
  if (mode === 'AUDIO') return undefined;
  if (typeof MediaRecorder.isTypeSupported !== 'function') throw new RecordingFailure('VIDEO_RECORDER_UNSUPPORTED');
  const mimeType = VIDEO_CAPTURE_MIME_CANDIDATES
    .find(candidate => MediaRecorder.isTypeSupported(candidate));
  if (!mimeType) throw new RecordingFailure('VIDEO_RECORDER_UNSUPPORTED');
  return { mimeType };
}

/** A capability probe owns no recording artifact or retained chunks. */
export async function probeRecording(mode: Exclude<PracticeRecordingMode, 'OFF'>, stream: MediaStream, signal: AbortSignal, openSink: RecordingSinkFactory = openOpfsRecordingSink): Promise<void> {
  signal.throwIfAborted();
  if (!stream.getAudioTracks().some(track => track.readyState === 'live')
    || (mode === 'VIDEO' && !stream.getVideoTracks().some(track => track.readyState === 'live'))) {
    throw new RecordingFailure('RECORDING_TRACKS_UNAVAILABLE');
  }
  let recorder: MediaRecorder;
  try { recorder = new MediaRecorder(stream, recordingOptions(mode)); } catch (cause) { throw recordingBrowserFailure(cause); }
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const abort = () => finish(signal.reason);
    const timer = setTimeout(() => finish(new RecordingFailure('RECORDING_PROBE_TIMEOUT')), 5000);
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); signal.removeEventListener('abort', abort); recorder.onstop = null; recorder.onerror = null; recorder.ondataavailable = null;
      try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* Teardown preserves probe error. */ }
      if (error !== undefined) reject(error); else resolve();
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    recorder.onerror = () => finish(new RecordingFailure('RECORDING_PROBE_FAILED'));
    recorder.onstop = () => finish(isArchiveableCaptureMime(mode, recorder.mimeType) ? undefined
      : new RecordingFailure(mode === 'VIDEO' ? 'VIDEO_RECORDER_UNSUPPORTED' : 'MEDIA_RECORDER_UNSUPPORTED'));
    try { recorder.start(); recorder.stop(); } catch { finish(new RecordingFailure('RECORDING_PROBE_FAILED')); }
  });
  signal.throwIfAborted();
  const sink = await openSink(signal);
  let media: OwnedMediaHandle | null = null;
  let retirement: Promise<void> | null = null;
  const cancel = () => { retirement = sink.abort(); retirement.catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    signal.throwIfAborted();
    await sink.append(new Blob(['noteverse-capture-probe']));
    signal.throwIfAborted();
    media = await sink.seal(recorder.mimeType);
    signal.throwIfAborted();
  } catch (cause) {
    if (signal.aborted) throw signal.reason;
    throw new RecordingFailure('RECORDING_STORAGE_FAILED', { cause });
  } finally {
    signal.removeEventListener('abort', cancel);
    try {
      if (media) await media.release(); else await (retirement ?? sink.abort());
    } catch (cause) {
      if (signal.aborted) throw signal.reason;
      throw new RecordingFailure('RECORDING_STORAGE_FAILED', { cause });
    }
  }
}
