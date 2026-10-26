import { createPerformanceRecording, type PerformanceRecording } from './recording-artifact';
import type { RecordingActiveSegment } from './recording-timebase';
import type { PracticeInputSource } from '@/lib/practice/kernel/session';

import type { PracticeRecordingMode } from './recording-mode';
import { recordingOptions } from './recorder-capability';
import { RecordingPreparationError, recordingPreparationError } from './recording-preparation-error';

type RecorderState =
  | 'NOT_STARTED'
  | 'PREPARATION_FAILED'
  | 'RECORDING'
  | 'PAUSED'
  | 'FINALIZING'
  | 'READY'
  | 'UNAVAILABLE';

type PrepareOptions = {
  inputSource: PracticeInputSource;
  sessionMicrophoneStream?: MediaStream | null;
  cameraStream?: MediaStream | null;
};

type RecorderStopResult = 'STOPPED' | 'TIMEOUT' | 'FAILED';

function createContinuousVideoStream(
  cameraStream: MediaStream | null | undefined,
  audioStream?: MediaStream | null
): MediaStream {
  const videoTracks = cameraStream?.getVideoTracks() ?? [];
  const audioTracks = audioStream?.getAudioTracks() ?? cameraStream?.getAudioTracks() ?? [];
  if (videoTracks.length === 0 || videoTracks[0].readyState !== 'live') throw new RecordingPreparationError('RECORDING_VIDEO_UNAVAILABLE');
  if (audioTracks.length === 0 || audioTracks[0].readyState !== 'live') throw new RecordingPreparationError('RECORDING_AUDIO_UNAVAILABLE');
  return new MediaStream([videoTracks[0], audioTracks[0]]);
}

function createEmptyTimebase(): { activeSegments: RecordingActiveSegment[]; nominalMediaDurationMs: number } {
  return {
    activeSegments: [],
    nominalMediaDurationMs: 0,
  };
}

export class PerformanceRecorder {
  private readonly mode: PracticeRecordingMode;
  private recorder: MediaRecorder | null = null;
  private readonly chunks: Blob[] = [];
  private ownedStream: MediaStream | null = null;
  private sourceOwnership: 'NONE' | 'OWNED_ACQUISITION' | 'OWNED_CLONE' = 'NONE';
  private disposed = false;
  private admitted = false;
  private mediaKind: 'AUDIO' | 'VIDEO' = 'AUDIO';
  private unavailableReason: string | null = null;
  private state: RecorderState = 'NOT_STARTED';
  private stopPromise: Promise<RecorderStopResult> | null = null;
  private timebase = createEmptyTimebase();
  private currentSegmentStartPerfMs: number | null = null;
  private currentSegmentStartMediaMs = 0;
  private cumulativeMediaMs = 0;

  constructor(mode: PracticeRecordingMode) {
    this.mode = mode;
  }

  async prepare(options: PrepareOptions): Promise<void> {
    if (this.mode === 'OFF') {
      return;
    }
    try {
      if (this.disposed) throw new RecordingPreparationError('RECORDING_PREPARATION_CANCELLED');
      const recorderOptions = recordingOptions(this.mode);
      if (this.mode === 'AUDIO') {
        const stream = await this.resolveAudioStream(options);
        this.assertTracks(stream, 'AUDIO');
        if (this.disposed) throw new RecordingPreparationError('RECORDING_PREPARATION_CANCELLED');
        this.installRecorder(new MediaRecorder(stream, recorderOptions), stream, 'AUDIO');
      } else {
        const borrowed = createContinuousVideoStream(options.cameraStream, options.sessionMicrophoneStream);
        const stream = borrowed.clone();
        this.ownedStream = stream; this.sourceOwnership = 'OWNED_CLONE';
        this.assertTracks(stream, 'VIDEO');
        if (this.disposed) throw new RecordingPreparationError('RECORDING_PREPARATION_CANCELLED');
        this.installRecorder(new MediaRecorder(stream, recorderOptions), stream, 'VIDEO');
      }
      this.admitted = true;
      this.assertPrepared();
    } catch (error) {
      this.admitted = false;
      this.stopAndCleanup();
      this.state = 'PREPARATION_FAILED';
      throw recordingPreparationError(error);
    }
  }

  /** Recheck admission immediately before transport starts, without reacquisition. */
  assertPrepared(): void {
    if (this.mode === 'OFF') return;
    if (this.disposed) throw new RecordingPreparationError('RECORDING_PREPARATION_CANCELLED');
    if (!this.admitted || !this.recorder || this.recorder.state !== 'inactive' || this.state !== 'NOT_STARTED' || !this.ownedStream) {
      throw new RecordingPreparationError('RECORDER_INIT_FAILED');
    }
    this.assertTracks(this.ownedStream, this.mode);
  }

  startIfReady(performanceTimeMs: number): void {
    if (
      this.state !== 'NOT_STARTED' ||
      !this.recorder ||
      this.recorder.state !== 'inactive'
    ) {
      return;
    }
    this.currentSegmentStartPerfMs = performanceTimeMs;
    this.currentSegmentStartMediaMs = 0;
    this.cumulativeMediaMs = 0;
    try {
      this.recorder.start(250);
      this.state = 'RECORDING';
    } catch (error) {
      this.markUnavailable(error instanceof Error ? error.message : 'RECORDING_START_FAILED');
    }
  }

  pause(performanceTimeMs: number): void {
    if (!this.recorder || this.recorder.state !== 'recording') {
      return;
    }
    this.closeActiveSegment(performanceTimeMs);
    try {
      this.recorder.pause();
      this.state = 'PAUSED';
    } catch {
      this.markUnavailable('RECORDER_PAUSE_FAILED');
    }
  }

  resume(performanceTimeMs: number): void {
    if (!this.recorder || this.recorder.state !== 'paused') {
      return;
    }
    try {
      this.recorder.resume();
      this.state = 'RECORDING';
      this.currentSegmentStartPerfMs = performanceTimeMs;
      this.currentSegmentStartMediaMs = this.cumulativeMediaMs;
    } catch {
      this.markUnavailable('RECORDER_RESUME_FAILED');
    }
  }

  freeze(performanceEndMs: number): Promise<RecorderStopResult> {
    if (this.stopPromise) {
      return this.stopPromise;
    }
    this.closeActiveSegment(performanceEndMs);
    this.timebase.nominalMediaDurationMs = this.cumulativeMediaMs;

    if (this.mode === 'OFF') {
      this.stopPromise = Promise.resolve('STOPPED');
      return this.stopPromise;
    }

    const recorder = this.recorder;
    this.state = 'FINALIZING';
    if (!recorder || recorder.state === 'inactive') {
      this.markUnavailable(this.unavailableReason ?? 'RECORDER_NOT_ACTIVE');
      this.stopPromise = Promise.resolve('FAILED');
      return this.stopPromise;
    }
    this.stopPromise = new Promise<RecorderStopResult>((resolve) => {
      const timeoutId = setTimeout(() => {
        this.markUnavailable('RECORDER_STOP_TIMEOUT');
        resolve('TIMEOUT');
      }, 1500);
      const settle = (result: RecorderStopResult) => {
        clearTimeout(timeoutId);
        resolve(result);
      };
      recorder.onstop = () => settle('STOPPED');
      recorder.onerror = () => {
        this.markUnavailable('MEDIA_RECORDER_ERROR');
        settle('FAILED');
      };
      try {
        if (typeof recorder.requestData === 'function') {
          recorder.requestData();
        }
        recorder.stop();
      } catch {
        this.markUnavailable('RECORDER_STOP_FAILED');
        settle('FAILED');
      }
    });
    return this.stopPromise;
  }

  async finalize(): Promise<PerformanceRecording> {
    if (this.disposed) throw new Error('RECORDING_DISCARDED');
    if (this.mode !== 'OFF' && !this.admitted) throw new RecordingPreparationError('RECORDER_INIT_FAILED');
    let stopResult: RecorderStopResult | null = null;
    if (this.stopPromise) {
      stopResult = await this.stopPromise;
    }

    if (this.disposed) throw new Error('RECORDING_DISCARDED');
    if (this.mode === 'OFF') {
      return createPerformanceRecording({ status: 'NOT_RECORDED' });
    }

    const totalBytes = this.chunks.reduce((acc, chunk) => acc + (chunk?.size ?? 0), 0);
    if (
      stopResult !== 'STOPPED'
      || totalBytes === 0
      || this.unavailableReason !== null
      || this.state === 'UNAVAILABLE'
    ) {
      this.state = 'UNAVAILABLE';
      return createPerformanceRecording({
        status: 'UNAVAILABLE',
        reason: this.unavailableReason
          ?? (stopResult && stopResult !== 'STOPPED'
            ? 'RECORDER_STOP_FAILED'
            : totalBytes === 0
              ? 'EMPTY_RECORDING_BLOB'
              : 'RECORDING_NOT_AVAILABLE'),
      });
    }

    this.state = 'READY';
    const fallbackMimeType = this.mediaKind === 'VIDEO' ? 'video/webm' : 'audio/webm';
    const mimeType = this.recorder?.mimeType || fallbackMimeType;
    return createPerformanceRecording({
      status: 'READY',
      kind: this.mediaKind,
      blob: new Blob(this.chunks, { type: mimeType }),
      mimeType,
      durationMs: Math.max(0, Math.round(this.timebase.nominalMediaDurationMs)),
      timebase: this.timebase,
    });
  }

  stopAndCleanup(): void {
    this.disposed = true;
    const recorder = this.recorder;
    this.recorder = null;
    if (recorder) { recorder.ondataavailable = null; recorder.onerror = null; }
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        // Ignore stop errors during teardown.
      }
    }

    this.chunks.length = 0; this.timebase = createEmptyTimebase();
    this.currentSegmentStartPerfMs = null; this.cumulativeMediaMs = 0;
    this.releaseStream();
  }

  snapshot() { return Object.freeze({ state: this.mode === 'OFF' ? 'OFF' as const : this.state,
    sourceOwnership: this.sourceOwnership, unavailableReason: this.unavailableReason }); }

  private releaseStream(): void {
    const stream = this.ownedStream;
    this.ownedStream = null;
    this.sourceOwnership = 'NONE';
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    }
  }

  private async resolveAudioStream(options: PrepareOptions): Promise<MediaStream> {
    if (options.inputSource === 'MICROPHONE') {
      if (!options.sessionMicrophoneStream) throw new RecordingPreparationError('RECORDING_AUDIO_UNAVAILABLE');
      this.assertTracks(options.sessionMicrophoneStream, 'AUDIO');
      const clone = options.sessionMicrophoneStream.clone();
      this.ownedStream = clone; this.sourceOwnership = 'OWNED_CLONE'; return clone;
    }
    const mediaDevices = globalThis.navigator?.mediaDevices;
    if (!mediaDevices?.getUserMedia) {
      throw new RecordingPreparationError('RECORDING_AUDIO_UNAVAILABLE');
    }
    const stream = await mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    this.ownedStream = stream;
    this.sourceOwnership = 'OWNED_ACQUISITION';
    return stream;
  }

  private installRecorder(
    recorder: MediaRecorder,
    stream: MediaStream,
    mediaKind: 'AUDIO' | 'VIDEO'
  ): void {
    const tracks = stream.getTracks();
    this.recorder = recorder;
    this.assertTracks(stream, mediaKind);
    this.mediaKind = mediaKind;
    recorder.ondataavailable = (event) => {
      if (!this.disposed && event.data && event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };
    recorder.onerror = () => {
      this.markUnavailable('MEDIA_RECORDER_ERROR');
    };
    for (const track of tracks) {
      track.addEventListener(
        'ended',
        () => {
          if (this.state === 'RECORDING' || this.state === 'PAUSED' || this.state === 'FINALIZING') {
            this.markUnavailable(
              mediaKind === 'VIDEO' && track.kind === 'video'
                ? 'VIDEO_TRACK_ENDED'
                : 'AUDIO_TRACK_ENDED'
            );
          }
        },
        { once: true }
      );
    }
  }

  private assertTracks(stream: MediaStream, mode: 'AUDIO' | 'VIDEO'): void {
    const audio = stream.getAudioTracks();
    if (!audio.length || audio.some(track => track.readyState !== 'live')) throw new RecordingPreparationError('RECORDING_AUDIO_UNAVAILABLE');
    if (mode === 'VIDEO') {
      const video = stream.getVideoTracks();
      if (!video.length || video.some(track => track.readyState !== 'live')) throw new RecordingPreparationError('RECORDING_VIDEO_UNAVAILABLE');
    }
  }

  private closeActiveSegment(performanceEndMs: number): void {
    if (this.currentSegmentStartPerfMs === null) {
      return;
    }
    const perfEndMs = Math.max(this.currentSegmentStartPerfMs, performanceEndMs);
    const segmentDuration = Math.max(0, perfEndMs - this.currentSegmentStartPerfMs);
    const mediaEndMs = this.currentSegmentStartMediaMs + segmentDuration;
    this.timebase.activeSegments.push({
      perfStartMs: this.currentSegmentStartPerfMs,
      perfEndMs,
      mediaStartMs: this.currentSegmentStartMediaMs,
      mediaEndMs,
    });
    this.cumulativeMediaMs = mediaEndMs;
    this.currentSegmentStartPerfMs = null;
  }

  private markUnavailable(reason: string): void {
    this.unavailableReason = this.unavailableReason ?? reason;
    this.state = 'UNAVAILABLE';
  }
}
