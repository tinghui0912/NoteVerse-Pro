import type {
  PerformanceMedia,
  RecordingTimebaseMapping,
} from './completed-performance';
import type { PracticeInputSource } from './local-core/artifact';

export type PracticeRecordingMode = 'OFF' | 'AUDIO' | 'VIDEO';

type RecorderState =
  | 'NOT_STARTED'
  | 'RECORDING'
  | 'PAUSED'
  | 'FINALIZING'
  | 'READY'
  | 'UNAVAILABLE';

type PrepareOptions = {
  inputSource: PracticeInputSource;
  analysisStream?: MediaStream | null;
  cameraStream?: MediaStream | null;
};

type FinalizedRecording = {
  media: PerformanceMedia;
  timebase: RecordingTimebaseMapping;
};

type RecorderStopResult = 'STOPPED' | 'TIMEOUT' | 'FAILED';

function preferredVideoRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined;
  }
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

function createContinuousVideoStream(
  cameraStream: MediaStream | null | undefined,
  audioStream?: MediaStream | null
): MediaStream | null {
  const videoTracks = cameraStream?.getVideoTracks() ?? [];
  const audioTracks = audioStream?.getAudioTracks() ?? cameraStream?.getAudioTracks() ?? [];
  if (videoTracks.length === 0 || audioTracks.length === 0) {
    return null;
  }
  return new MediaStream([videoTracks[0], audioTracks[0]]);
}

function createEmptyTimebase(): RecordingTimebaseMapping {
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
  private mediaKind: 'AUDIO' | 'VIDEO' = 'AUDIO';
  private unavailableReason: string | null = null;
  private state: RecorderState = 'NOT_STARTED';
  private stopPromise: Promise<RecorderStopResult> | null = null;
  private timebase: RecordingTimebaseMapping = createEmptyTimebase();
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
    if (typeof MediaRecorder === 'undefined') {
      this.markUnavailable('MEDIA_RECORDER_UNSUPPORTED');
      return;
    }

    try {
      if (this.mode === 'AUDIO') {
        const stream = await this.resolveAudioStream(options);
        if (!stream) {
          this.markUnavailable('AUDIO_STREAM_UNAVAILABLE');
          return;
        }
        this.installRecorder(new MediaRecorder(stream), stream, 'AUDIO');
        return;
      }

      const stream = createContinuousVideoStream(options.cameraStream, options.analysisStream);
      if (!stream) {
        this.markUnavailable('CAMERA_AUDIO_VIDEO_STREAM_UNAVAILABLE');
        return;
      }
      const recorderOptions = preferredVideoRecorderMimeType()
        ? { mimeType: preferredVideoRecorderMimeType() }
        : undefined;
      this.installRecorder(new MediaRecorder(stream, recorderOptions), stream, 'VIDEO');
    } catch (error) {
      this.markUnavailable(error instanceof DOMException ? error.name : 'RECORDER_INIT_FAILED');
    }
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

  async finalize(): Promise<FinalizedRecording> {
    let stopResult: RecorderStopResult | null = null;
    if (this.stopPromise) {
      stopResult = await this.stopPromise;
    }

    if (this.mode === 'OFF') {
      return {
        media: { status: 'NOT_RECORDED' },
        timebase: structuredClone(this.timebase),
      };
    }

    const totalBytes = this.chunks.reduce((acc, chunk) => acc + (chunk?.size ?? 0), 0);
    if (
      stopResult !== 'STOPPED'
      || totalBytes === 0
      || this.unavailableReason !== null
      || this.state === 'UNAVAILABLE'
    ) {
      this.state = 'UNAVAILABLE';
      return {
        media: {
          status: 'UNAVAILABLE',
          reason: this.unavailableReason
            ?? (stopResult && stopResult !== 'STOPPED'
              ? 'RECORDER_STOP_FAILED'
              : totalBytes === 0
                ? 'EMPTY_RECORDING_BLOB'
                : 'RECORDING_NOT_AVAILABLE'),
        },
        timebase: structuredClone(this.timebase),
      };
    }

    this.state = 'READY';
    const fallbackMimeType = this.mediaKind === 'VIDEO' ? 'video/webm' : 'audio/webm';
    const mimeType = this.recorder?.mimeType || fallbackMimeType;
    return {
      media: {
        status: 'READY',
        kind: this.mediaKind,
        blob: new Blob(this.chunks, { type: mimeType }),
        mimeType,
        durationMs: Math.max(0, Math.round(this.timebase.nominalMediaDurationMs)),
      },
      timebase: structuredClone(this.timebase),
    };
  }

  stopAndCleanup(): void {
    const recorder = this.recorder;
    this.recorder = null;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        // Ignore stop errors during teardown.
      }
    }

    const stream = this.ownedStream;
    this.ownedStream = null;
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    }
  }

  private async resolveAudioStream(options: PrepareOptions): Promise<MediaStream | null> {
    if (options.inputSource === 'MICROPHONE' && options.analysisStream) {
      return options.analysisStream;
    }
    const mediaDevices = globalThis.navigator?.mediaDevices;
    if (!mediaDevices?.getUserMedia) {
      this.markUnavailable('MEDIA_DEVICES_UNAVAILABLE');
      return null;
    }
    const stream = await mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    this.ownedStream = stream;
    return stream;
  }

  private installRecorder(
    recorder: MediaRecorder,
    stream: MediaStream,
    mediaKind: 'AUDIO' | 'VIDEO'
  ): void {
    const tracks = stream.getTracks();
    const deadTrack = tracks.find((track) => track.readyState !== 'live');
    if (deadTrack) {
      this.markUnavailable(
        mediaKind === 'VIDEO' && deadTrack.kind === 'video'
          ? 'VIDEO_TRACK_NOT_LIVE'
          : 'AUDIO_TRACK_NOT_LIVE'
      );
      return;
    }

    this.mediaKind = mediaKind;
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
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
    this.recorder = recorder;
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
