import { createPerformanceRecording, type PerformanceRecording } from './recording-artifact';
import type { RecordingActiveSegment } from './recording-timebase';

import type { PracticeRecordingMode } from './recording-mode';
import { recordingOptions } from './recorder-capability';
import { isArchiveableCaptureMime } from './media-policy';
import { RecordingFailure } from '@/lib/practice/failure/causal-failure';
import { recordingBrowserFailure } from '@/lib/practice/failure/browser-failures';
import type { RecordingRuntimeFault, RecordingRuntimeInterruption, RecordingRuntimeFailureReason } from './recording-runtime-fault';

type RecorderState =
  | 'NOT_STARTED'
  | 'PREPARATION_FAILED'
  | 'RECORDING'
  | 'PAUSED'
  | 'INTERRUPTED'
  | 'FINALIZING'
  | 'READY'
  | 'UNAVAILABLE';

type PrepareOptions = {
  audioRoot?: MediaStream | null;
  cameraStream?: MediaStream | null;
};

type RecorderStopResult = 'STOPPED' | 'TIMEOUT' | 'FAILED';

function createContinuousVideoStream(
  cameraStream: MediaStream | null | undefined,
  audioStream?: MediaStream | null
): MediaStream {
  const videoTracks = cameraStream?.getVideoTracks() ?? [];
  const audioTracks = audioStream?.getAudioTracks() ?? [];
  if (videoTracks.length === 0 || videoTracks[0].readyState !== 'live') throw new RecordingFailure('RECORDING_VIDEO_UNAVAILABLE');
  if (audioTracks.length === 0 || audioTracks[0].readyState !== 'live') throw new RecordingFailure('RECORDING_AUDIO_UNAVAILABLE');
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
  private readonly sourceHealth = new Map<'AUDIO' | 'VIDEO', 'HEALTHY' | 'INTERRUPTED' | 'LOST'>();
  private ownedStream: MediaStream | null = null;
  private sourceOwnership: 'NONE' | 'OWNED_CLONE' = 'NONE';
  private disposed = false;
  private admitted = false;
  private runtimeActive = false;
  private fault: RecordingRuntimeInterruption | null = null;
  private acceptedLoss = false;
  private mediaStarted = false;
  private readonly faultListeners = new Set<(fault: RecordingRuntimeInterruption) => void>();
  private readonly detachTracks: (() => void)[] = [];
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
      if (this.disposed) throw new RecordingFailure('RECORDING_PREPARATION_CANCELLED');
      const recorderOptions = recordingOptions(this.mode);
      if (this.mode === 'AUDIO') {
        const stream = await this.resolveAudioStream(options);
        this.assertTracks(stream, 'AUDIO');
        if (this.disposed) throw new RecordingFailure('RECORDING_PREPARATION_CANCELLED');
        this.installRecorder(new MediaRecorder(stream, recorderOptions), stream, 'AUDIO');
      } else {
        const borrowed = createContinuousVideoStream(options.cameraStream, options.audioRoot);
        const stream = borrowed.clone();
        this.ownedStream = stream; this.sourceOwnership = 'OWNED_CLONE';
        this.assertTracks(stream, 'VIDEO');
        if (this.disposed) throw new RecordingFailure('RECORDING_PREPARATION_CANCELLED');
        this.installRecorder(new MediaRecorder(stream, recorderOptions), stream, 'VIDEO');
      }
      this.admitted = true;
      this.assertPrepared();
    } catch (error) {
      this.admitted = false;
      this.stopAndCleanup();
      this.state = 'PREPARATION_FAILED';
      throw recordingBrowserFailure(error);
    }
  }

  /** Recheck admission immediately before transport starts, without reacquisition. */
  assertPrepared(): void {
    if (this.mode === 'OFF') return;
    if (this.disposed) throw new RecordingFailure('RECORDING_PREPARATION_CANCELLED');
    if (!this.admitted || !this.recorder || this.recorder.state !== 'inactive' || this.state !== 'NOT_STARTED' || !this.ownedStream) {
      throw new RecordingFailure('RECORDER_INIT_FAILED');
    }
    if ([...this.sourceHealth.values()].some(health => health !== 'HEALTHY')) throw new RecordingFailure('RECORDER_INIT_FAILED');
    this.assertTracks(this.ownedStream, this.mode);
  }

  onRuntimeFault(listener: (fault: RecordingRuntimeInterruption) => void): () => void {
    this.faultListeners.add(listener); return () => { this.faultListeners.delete(listener); };
  }
  activate(): void { this.assertPrepared(); this.runtimeActive = this.mode !== 'OFF'; }
  runtimeFault(): RecordingRuntimeInterruption | null { return this.fault; }
  /** Device Lease health events are facts; this owner decides recorder continuity. */
  observeSourceHealth(sources: Readonly<{
    audio: 'HEALTHY' | 'INTERRUPTED' | 'LOST';
    video?: 'HEALTHY' | 'INTERRUPTED' | 'LOST';
  }>): void {
    if (this.disposed || this.acceptedLoss || this.mode === 'OFF') return;
    this.sourceHealth.set('AUDIO', sources.audio);
    if (this.mode === 'VIDEO') this.sourceHealth.set('VIDEO', sources.video ?? 'LOST');
    if (!this.runtimeActive) return;
    const failed = [...this.sourceHealth].find(([, health]) => health === 'LOST')
      ?? [...this.sourceHealth].find(([, health]) => health === 'INTERRUPTED');
    if (!failed) this.observeRecovery();
    else {
      const [kind, health] = failed;
      this.interrupt(kind === 'VIDEO'
        ? health === 'LOST' ? 'VIDEO_TRACK_ENDED' : 'VIDEO_TRACK_MUTED'
        : health === 'LOST' ? 'AUDIO_TRACK_ENDED' : 'AUDIO_TRACK_MUTED',
        health === 'LOST' ? 'RESTART_REQUIRED' : 'SAME_PIPELINE_RECOVERABLE');
    }
  }
  private samePipelineHealthy(): boolean {
    if (this.disposed || !this.fault || this.fault.recoverability !== 'SAME_PIPELINE_RECOVERABLE' || !this.ownedStream || !this.recorder) return false;
    if ([...this.sourceHealth.values()].some(health => health !== 'HEALTHY')) return false;
    if (!this.ownedStream.getTracks().every(track => track.readyState === 'live' && !track.muted)
      || !['paused', 'recording', ...(!this.mediaStarted ? ['inactive'] : [])].includes(this.recorder.state)) return false;
    return true;
  }
  recoverRuntime(): boolean {
    if (this.fault?.state !== 'RECOVERED_WAITING_FOR_USER' || !this.samePipelineHealthy()) return false;
    this.fault = null;
    this.state = this.recorder!.state === 'paused' ? 'PAUSED' : this.recorder!.state === 'recording' ? 'RECORDING' : 'NOT_STARTED';
    return true;
  }
  continueWithoutRecording(): void {
    if (!this.fault || this.disposed) return;
    this.unavailableReason = this.fault.reason; this.acceptedLoss = true; this.runtimeActive = false;
    this.state = 'UNAVAILABLE'; this.discardPipeline(); this.fault = null;
  }

  startIfReady(performanceTimeMs: number): void {
    if (
      this.state !== 'NOT_STARTED' ||
      !this.recorder ||
      this.recorder.state !== 'inactive'
    ) {
      return;
    }
    this.runtimeActive = true;
    this.currentSegmentStartPerfMs = performanceTimeMs;
    this.currentSegmentStartMediaMs = 0;
    this.cumulativeMediaMs = 0;
    try {
      this.recorder.start(250);
      this.mediaStarted = true;
      this.state = 'RECORDING';
    } catch {
      this.interrupt('RECORDER_START_FAILED', 'RESTART_REQUIRED');
    }
  }

  pause(performanceTimeMs: number): void {
    if (!this.recorder || this.recorder.state !== 'recording') {
      return;
    }
    this.closeActiveSegment(performanceTimeMs);
    try {
      this.recorder.pause();
      if (!this.fault) this.state = 'PAUSED';
    } catch {
      this.interrupt('RECORDER_PAUSE_FAILED', 'RESTART_REQUIRED');
    }
  }

  resume(performanceTimeMs: number): void {
    if (this.fault || !this.recorder || this.recorder.state !== 'paused') {
      return;
    }
    try {
      this.recorder.resume();
      this.state = 'RECORDING';
      this.currentSegmentStartPerfMs = performanceTimeMs;
      this.currentSegmentStartMediaMs = this.cumulativeMediaMs;
    } catch {
      this.interrupt('RECORDER_RESUME_FAILED', 'RESTART_REQUIRED');
    }
  }

  freeze(performanceEndMs: number): Promise<RecorderStopResult> {
    if (this.stopPromise) {
      return this.stopPromise;
    }
    this.runtimeActive = false;
    this.closeActiveSegment(performanceEndMs);
    this.timebase.nominalMediaDurationMs = this.cumulativeMediaMs;

    if (this.mode === 'OFF') {
      this.stopPromise = Promise.resolve('STOPPED');
      return this.stopPromise;
    }
    if (this.acceptedLoss) { this.stopPromise = Promise.resolve('FAILED'); return this.stopPromise; }
    if (this.fault) {
      // freeze belongs to the already-latched natural terminal transaction.
      this.unavailableReason ??= this.fault.reason; this.fault = null; this.discardPipeline();
      this.stopPromise = Promise.resolve('FAILED'); return this.stopPromise;
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
    if (this.disposed) throw new RecordingFailure('RECORDING_DISCARDED');
    if (this.mode !== 'OFF' && !this.admitted) throw new RecordingFailure('RECORDER_INIT_FAILED');
    if (this.fault) throw new RecordingFailure('RECORDING_DECISION_REQUIRED');
    let stopResult: RecorderStopResult | null = null;
    if (this.stopPromise) {
      stopResult = await this.stopPromise;
    }

    if (this.disposed) throw new RecordingFailure('RECORDING_DISCARDED');
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

    const mimeType = this.recorder?.mimeType ?? '';
    if (!isArchiveableCaptureMime(this.mediaKind, mimeType)) {
      this.markUnavailable(this.mediaKind === 'VIDEO' ? 'VIDEO_RECORDER_UNSUPPORTED' : 'MEDIA_RECORDER_UNSUPPORTED');
      return createPerformanceRecording({ status: 'UNAVAILABLE', reason: this.unavailableReason! });
    }
    this.state = 'READY';
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
    this.runtimeActive = false; this.fault = null; this.faultListeners.clear();
    this.discardPipeline();
    this.chunks.length = 0; this.timebase = createEmptyTimebase();
    this.currentSegmentStartPerfMs = null; this.cumulativeMediaMs = 0;
  }

  private discardPipeline(): void {
    const recorder = this.recorder;
    this.recorder = null;
    if (recorder) { recorder.ondataavailable = null; recorder.onerror = null; recorder.onpause = null; recorder.onresume = null; recorder.onstart = null; }
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        // Ignore stop errors during teardown.
      }
    }

    this.chunks.length = 0;
    this.releaseStream();
  }

  snapshot(performanceTimeMs = 0) { return Object.freeze({
    indicatorVisible: this.mediaStarted && !this.acceptedLoss && !this.disposed,
    elapsedMs: this.cumulativeMediaMs + (this.currentSegmentStartPerfMs === null ? 0 : Math.max(0, performanceTimeMs - this.currentSegmentStartPerfMs)),
    state: this.mode === 'OFF' ? 'OFF' as const : this.state,
    sourceOwnership: this.sourceOwnership, unavailableReason: this.unavailableReason }); }

  private releaseStream(): void {
    this.detachTracks.splice(0).forEach(detach => detach());
    const stream = this.ownedStream;
    this.ownedStream = null; this.sourceHealth.clear();
    this.sourceOwnership = 'NONE';
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    }
  }

  private async resolveAudioStream(options: PrepareOptions): Promise<MediaStream> {
    if (!options.audioRoot) throw new RecordingFailure('RECORDING_AUDIO_UNAVAILABLE');
    this.assertTracks(options.audioRoot, 'AUDIO');
    const clone = options.audioRoot.clone();
    this.ownedStream = clone; this.sourceOwnership = 'OWNED_CLONE'; return clone;
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
      this.interrupt('MEDIA_RECORDER_ERROR', 'RESTART_REQUIRED');
    };
    recorder.onpause = recorder.onresume = recorder.onstart = () => this.observeRecovery();
    recorder.onstop = () => { if (this.runtimeActive) this.interrupt('RECORDER_NOT_ACTIVE', 'RESTART_REQUIRED'); };
    for (const track of tracks) {
      const ended = () => this.interrupt(track.kind === 'video' ? 'VIDEO_TRACK_ENDED' : 'AUDIO_TRACK_ENDED', 'RESTART_REQUIRED');
      const muted = () => this.interrupt(track.kind === 'video' ? 'VIDEO_TRACK_MUTED' : 'AUDIO_TRACK_MUTED', 'SAME_PIPELINE_RECOVERABLE');
      const unmuted = () => this.observeRecovery();
      track.addEventListener('ended', ended); track.addEventListener('mute', muted); track.addEventListener('unmute', unmuted);
      this.detachTracks.push(() => { track.removeEventListener('ended', ended); track.removeEventListener('mute', muted); track.removeEventListener('unmute', unmuted); });
    }
  }

  private assertTracks(stream: MediaStream, mode: 'AUDIO' | 'VIDEO'): void {
    const audio = stream.getAudioTracks();
    if (!audio.length || audio.some(track => track.readyState !== 'live')) throw new RecordingFailure('RECORDING_AUDIO_UNAVAILABLE');
    if (mode === 'VIDEO') {
      const video = stream.getVideoTracks();
      if (!video.length || video.some(track => track.readyState !== 'live')) throw new RecordingFailure('RECORDING_VIDEO_UNAVAILABLE');
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
  private interrupt(reason: RecordingRuntimeFailureReason, recoverability: RecordingRuntimeFault['recoverability']): void {
    if (this.disposed || this.acceptedLoss) return;
    if (!this.runtimeActive) { this.markUnavailable(reason); return; }
    if (this.fault) {
      if (recoverability === 'RESTART_REQUIRED' && this.fault.recoverability !== recoverability) {
        this.fault = Object.freeze({ ...this.fault, recoverability, state: 'WAITING_FOR_USER' });
        this.publishFault();
      } else this.observeRecovery();
      return;
    }
    this.fault = Object.freeze({ reason, recoverability, state: 'WAITING_FOR_USER' }); this.state = 'INTERRUPTED';
    this.publishFault();
  }
  private observeRecovery(): void {
    if (!this.fault || this.disposed || !this.runtimeActive || this.fault.recoverability === 'RESTART_REQUIRED') return;
    const state = this.samePipelineHealthy() ? 'RECOVERED_WAITING_FOR_USER' : 'WAITING_FOR_USER';
    if (state !== this.fault.state) { this.fault = Object.freeze({ ...this.fault, state }); this.publishFault(); }
  }
  private publishFault(): void { for (const listener of this.faultListeners) listener(this.fault!); }
}
