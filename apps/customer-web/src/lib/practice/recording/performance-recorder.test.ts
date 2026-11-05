// @vitest-environment jsdom
import { recordingSinkFixture, memoryRecordingSinkFactory } from '@/lib/practice/__fixtures__/recording-sink';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isArchiveableCaptureMime, normalizeCaptureMime } from './media-policy';
import { opfsStoreFixture } from '../__fixtures__/opfs-store';
import { openOpfsRecordingSink } from './opfs-recording-sink';
import { PerformanceRecorder } from './performance-recorder';

function createTrack(kind: 'audio' | 'video' = 'audio') {
  const events = new EventTarget();
  return {
    kind, readyState: 'live', muted: false, stop: vi.fn(),
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    end() { this.readyState = 'ended'; events.dispatchEvent(new Event('ended')); },
    mute() { this.muted = true; events.dispatchEvent(new Event('mute')); },
    unmute() { this.muted = false; events.dispatchEvent(new Event('unmute')); },
  };
}

function createStream(tracks = [createTrack('audio')]) {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((track) => track.kind === 'audio'),
    getVideoTracks: () => tracks.filter((track) => track.kind === 'video'),
    clone: () => createStream(tracks.map(track => createTrack(track.kind))),
  } as unknown as MediaStream;
}

type MockRecorderBehavior = {
  mimeType?: string;
  emitStop?: boolean;
  emitData?: boolean;
  throwOnStop?: boolean;
  throwOnPause?: boolean;
  throwOnResume?: boolean;
};

describe('PerformanceRecorder', () => {
  const originalMediaRecorder = globalThis.MediaRecorder;
  const originalMediaDevices = navigator.mediaDevices;
  let behavior: MockRecorderBehavior;
  let lastRecorder: { stream: MediaStream; ondataavailable: ((event: { data: Blob }) => void) | null; onerror: (() => void) | null } | null = null;

  function recordingTrack() { return lastRecorder!.stream.getAudioTracks()[0] as unknown as ReturnType<typeof createTrack>; }

  beforeEach(() => {
    behavior = { emitStop: true, emitData: true };
    lastRecorder = null;
    class MockMediaRecorder {
      static isTypeSupported() { return true; }
      state: 'inactive' | 'recording' | 'paused' = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;

      constructor(readonly stream: MediaStream, options?: MediaRecorderOptions) {
        this.mimeType = behavior.mimeType ?? options?.mimeType ?? 'audio/webm'; lastRecorder = this;
      }

      start() {
        this.state = 'recording';
      }

      requestData() {
        if (behavior.emitData) {
          this.ondataavailable?.({ data: new Blob(['final'], { type: this.mimeType }) });
        }
      }

      stop() {
        if (behavior.throwOnStop) {
          throw new Error('stop failed');
        }
        this.state = 'inactive';
        if (behavior.emitStop) {
          this.onstop?.();
        }
      }

      pause() {
        if (behavior.throwOnPause) throw new Error('pause failed');
        this.state = 'paused';
      }

      resume() {
        if (behavior.throwOnResume) throw new Error('resume failed');
        this.state = 'recording';
      }
    }
    Object.defineProperty(globalThis, 'MediaRecorder', {
      configurable: true,
      writable: true,
      value: MockMediaRecorder,
    });
  });

  it.each([
    ['AUDIO', 'audio/webm;codecs=opus'], ['AUDIO', 'audio/mp4'], ['AUDIO', 'audio/ogg'],
    ['AUDIO', 'audio/wav'], ['AUDIO', 'audio/x-wav'],
    ['VIDEO', 'video/webm;codecs=vp8,opus'], ['VIDEO', 'video/mp4;codecs=avc1'],
    ['AUDIO', 'audio/unknown'], ['VIDEO', 'video/quicktime'], ['VIDEO', 'audio/mp4'], ['AUDIO', ''],
  ] as const)('finalizes %s actual MIME %s only when it is archiveable', async (mode, mimeType) => {
    behavior.mimeType = mimeType;
    vi.stubGlobal('MediaStream', class {
      constructor(private tracks: MediaStreamTrack[]) {}
      getTracks() { return this.tracks; }
      getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
      getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
      clone() { return createStream(this.tracks.map(track => createTrack(track.kind as 'audio' | 'video'))); }
    });
    try {
      const recorder = new PerformanceRecorder(mode, memoryRecordingSinkFactory);
      await recorder.prepare({ audioRoot: createStream(), cameraStream: createStream([createTrack('video')]) });
      recorder.startIfReady(0); await recorder.freeze(1000);
      const result = await recorder.finalize();
      if (isArchiveableCaptureMime(mode, mimeType)) {
        expect(result.status).toBe('READY');
        if (result.status !== 'READY') throw new Error('Expected capture');
        expect(result.mimeType).toBe(mimeType);
        expect(result.media.blob.type).toBe(mimeType);
        expect(normalizeCaptureMime(result.mimeType)).toBe(mimeType.split(';')[0]);
        expect(await result.media.blob.text()).toBe('final');
      } else {
        expect(result).toMatchObject({ status: 'UNAVAILABLE', reason: expect.stringContaining('RECORDER_UNSUPPORTED') });
      }
      await recorder.stopAndCleanup();
    } finally { vi.unstubAllGlobals(); }
  });

  it('waits for the requestData final write and seal, then transfers the file beyond recorder cleanup', async () => {
    const f = opfsStoreFixture(); let write!: () => void;
    f.write.mockImplementationOnce(async (id, chunk) => {
      await new Promise<void>(resolve => { write = resolve; }); f.files.get(id)!.push(chunk);
    });
    const recorder = new PerformanceRecorder('AUDIO', signal => openOpfsRecordingSink(signal, f.platform));
    await recorder.prepare({ audioRoot: createStream() }); recorder.startIfReady(0);
    await recorder.freeze(100); let finished = false;
    const pending = recorder.finalize().then(media => { finished = true; return media; });
    await Promise.resolve(); expect(finished).toBe(false); expect(f.close).not.toHaveBeenCalled();
    write(); const recording = await pending;
    expect(recording.status).toBe('READY'); if (recording.status !== 'READY') throw new Error('Expected recording');
    expect(await recording.media.blob.text()).toBe('final'); expect(recording.media.blob.size).toBe(5);
    await recorder.stopAndCleanup(); expect(f.files.size).toBe(1);
    await recording.media.release(); expect(f.files.size).toBe(0);
  });

  it.each(['error', 'dispose'] as const)('retires a sealed file when %s occurs while final writes are pending', async ending => {
    const f = opfsStoreFixture(); let write!: () => void;
    f.write.mockImplementationOnce(async (id, chunk) => {
      await new Promise<void>(resolve => { write = resolve; }); f.files.get(id)!.push(chunk);
    });
    const recorder = new PerformanceRecorder('AUDIO', signal => openOpfsRecordingSink(signal, f.platform));
    await recorder.prepare({ audioRoot: createStream() }); recorder.startIfReady(0); await recorder.freeze(100);
    const pending = recorder.finalize();
    await Promise.resolve();
    if (ending === 'error') {
      lastRecorder!.onerror!(); write();
      expect(await pending).toMatchObject({ status: 'UNAVAILABLE', reason: 'MEDIA_RECORDER_ERROR' });
      await recorder.stopAndCleanup();
    } else {
      const cleanup = recorder.stopAndCleanup(); write();
      // Cancellation must not publish a READY file even when sealing was already in progress.
      const result = await pending;
      expect(result.status).toBe('UNAVAILABLE'); await cleanup;
    }
    expect(f.files.size).toBe(0); expect(f.remove).toHaveBeenCalledOnce(); expect(f.held.size).toBe(0);
  });

  it('awaits a late sink acquisition and aborts it before cleanup resolves', async () => {
    const capture = recordingSinkFixture(); let opened!: (sink: typeof capture.sink) => void;
    const recorder = new PerformanceRecorder('AUDIO', () => new Promise(resolve => { opened = resolve; }));
    const preparing = recorder.prepare({ audioRoot: createStream() });
    const rejected = expect(preparing).rejects.toThrow('RECORDING_PREPARATION_CANCELLED');
    let closed = false; const cleanup = recorder.stopAndCleanup().then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false); opened(capture.sink);
    await cleanup; await rejected;
    expect(capture.exists()).toBe(false); expect(capture.sink.abort).toHaveBeenCalledOnce();
  });

  it('latches an append failure as a recording-only hard fault and removes the abandoned file', async () => {
    const f = recordingSinkFixture(), recorder = new PerformanceRecorder('AUDIO', f.open);
    await recorder.prepare({ audioRoot: createStream() }); recorder.activate(); recorder.startIfReady(0);
    lastRecorder!.ondataavailable!({ data: new Blob(['first']) });
    vi.mocked(f.sink.append).mockRejectedValueOnce(new Error('disk full'));
    lastRecorder!.ondataavailable!({ data: new Blob(['second']) });
    await vi.waitFor(() => expect(recorder.runtimeFault()).toMatchObject({ reason: 'RECORDING_STORAGE_FAILED', recoverability: 'RESTART_REQUIRED' }));
    await recorder.continueWithoutRecording(); expect(f.exists()).toBe(false);
    await recorder.freeze(100); expect(await recorder.finalize()).toMatchObject({ status: 'UNAVAILABLE', reason: 'RECORDING_STORAGE_FAILED' });
    expect(f.sink.seal).not.toHaveBeenCalled(); await recorder.stopAndCleanup(); expect(f.remove).toHaveBeenCalledOnce();
  });

  it.each(['EMPTY', 'TIMEOUT', 'SEAL_FAILURE', 'UNSUPPORTED'] as const)('cleans untransferred storage after %s', async failure => {
    vi.useFakeTimers(); const f = recordingSinkFixture(), recorder = new PerformanceRecorder('AUDIO', f.open);
    if (failure === 'EMPTY') behavior.emitData = false;
    if (failure === 'TIMEOUT') behavior.emitStop = false;
    if (failure === 'UNSUPPORTED') behavior.mimeType = 'audio/unknown';
    if (failure === 'SEAL_FAILURE') vi.mocked(f.sink.seal).mockRejectedValueOnce(new Error('seal failed'));
    await recorder.prepare({ audioRoot: createStream() }); recorder.startIfReady(0);
    const stop = recorder.freeze(100);
    if (failure === 'TIMEOUT') await vi.advanceTimersByTimeAsync(1500);
    await stop; const recording = await recorder.finalize();
    expect(recording.status).toBe('UNAVAILABLE');
    if (failure === 'EMPTY') expect(recording).toMatchObject({ reason: 'EMPTY_RECORDING_BLOB' });
    if (failure === 'TIMEOUT') expect(recording).toMatchObject({ reason: 'RECORDER_STOP_TIMEOUT' });
    expect(f.exists()).toBe(false); await recorder.stopAndCleanup(); expect(f.remove).toHaveBeenCalledOnce();
  });

  it('propagates active storage cleanup failure instead of completing cleanup early', async () => {
    const f = recordingSinkFixture(), recorder = new PerformanceRecorder('AUDIO', f.open);
    await recorder.prepare({ audioRoot: createStream() });
    vi.mocked(f.sink.abort).mockRejectedValueOnce(new Error('storage cleanup failed'));
    await expect(recorder.stopAndCleanup()).rejects.toThrow('storage cleanup failed');
    expect(f.sink.abort).toHaveBeenCalledOnce();
  });

  it('consumes physical audio facts without subscribing to the borrowed track, while retaining clone health', async () => {
    const physical = createTrack(), root = createStream([physical]), listen = vi.spyOn(physical, 'addEventListener');
    const recorder = new PerformanceRecorder('AUDIO', memoryRecordingSinkFactory); await recorder.prepare({ audioRoot: root });
    recorder.observeSourceHealth({ audio: 'HEALTHY' }); recorder.activate(); recorder.startIfReady(0);
    expect(listen).not.toHaveBeenCalled(); expect(recordingTrack()).not.toBe(physical);
    physical.mute(); expect(recorder.runtimeFault()).toBeNull();
    recorder.observeSourceHealth({ audio: 'INTERRUPTED' }); recorder.pause(10);
    expect(recorder.runtimeFault()).toEqual({ reason: 'AUDIO_TRACK_MUTED', recoverability: 'SAME_PIPELINE_RECOVERABLE', state: 'WAITING_FOR_USER' });
    physical.unmute(); recorder.observeSourceHealth({ audio: 'HEALTHY' });
    expect(recorder.runtimeFault()?.state).toBe('RECOVERED_WAITING_FOR_USER'); expect(recorder.recoverRuntime()).toBe(true); recorder.resume(10);
    recordingTrack().end(); expect(recorder.runtimeFault()).toMatchObject({ reason: 'AUDIO_TRACK_ENDED', recoverability: 'RESTART_REQUIRED' });
    await recorder.stopAndCleanup(); expect(physical.stop).not.toHaveBeenCalled();
  });
  it('applies the complete physical snapshot before publishing recording recovery', async () => {
    const root = createStream(), camera = createStream([createTrack('video')]);
    vi.stubGlobal('MediaStream', class { constructor(private tracks: MediaStreamTrack[]) {} getTracks() { return this.tracks; }
      getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); } getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
      clone() { return createStream(this.tracks.map(track => createTrack(track.kind as 'audio' | 'video'))); }
    });
    try {
      const recorder = new PerformanceRecorder('VIDEO', memoryRecordingSinkFactory), faults = vi.fn();
      await recorder.prepare({ audioRoot: root, cameraStream: camera }); recorder.onRuntimeFault(faults);
      recorder.activate(); recorder.startIfReady(0);
      recorder.observeSourceHealth({ audio: 'INTERRUPTED', video: 'HEALTHY' }); recorder.pause(1);
      recorder.observeSourceHealth({ audio: 'HEALTHY', video: 'LOST' });
      expect(faults.mock.calls.every(([fact]) => fact.state === 'WAITING_FOR_USER')).toBe(true);
      expect(recorder.runtimeFault()?.recoverability).toBe('RESTART_REQUIRED'); await recorder.stopAndCleanup();
    } finally { vi.unstubAllGlobals(); }
  });
  it.each(['AUDIO', 'VIDEO'] as const)('%s physical loss preserves source-specific hard failure meaning', async kind => {
    const root = createStream(), camera = createStream([createTrack('video')]);
    vi.stubGlobal('MediaStream', class { constructor(private tracks: MediaStreamTrack[]) {} getTracks() { return this.tracks; }
      getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); } getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
      clone() { return createStream(this.tracks.map(track => createTrack(track.kind as 'audio' | 'video'))); }
    });
    try {
      const recorder = new PerformanceRecorder('VIDEO', memoryRecordingSinkFactory); await recorder.prepare({ audioRoot: root, cameraStream: camera });
      recorder.activate(); recorder.startIfReady(0); recorder.observeSourceHealth({ audio: kind === 'AUDIO' ? 'INTERRUPTED' : 'HEALTHY', video: kind === 'VIDEO' ? 'INTERRUPTED' : 'HEALTHY' }); recorder.pause(1);
      expect(recorder.runtimeFault()?.reason).toBe(kind === 'AUDIO' ? 'AUDIO_TRACK_MUTED' : 'VIDEO_TRACK_MUTED');
      recorder.observeSourceHealth({ audio: 'HEALTHY', video: 'HEALTHY' }); expect(recorder.runtimeFault()?.state).toBe('RECOVERED_WAITING_FOR_USER');
      expect(recorder.recoverRuntime()).toBe(true); recorder.resume(1); recorder.observeSourceHealth({ audio: kind === 'AUDIO' ? 'LOST' : 'HEALTHY', video: kind === 'VIDEO' ? 'LOST' : 'HEALTHY' });
      expect(recorder.runtimeFault()).toMatchObject({ reason: kind === 'AUDIO' ? 'AUDIO_TRACK_ENDED' : 'VIDEO_TRACK_ENDED', recoverability: 'RESTART_REQUIRED' });
      await recorder.stopAndCleanup();
    } finally { vi.unstubAllGlobals(); }
  });
  it('publishes one recoverable mute incident and recovers only the same healthy pipeline', async () => {
    const track = createTrack(), media = createStream([track]);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => media) } });
    const recorder = new PerformanceRecorder('AUDIO', memoryRecordingSinkFactory), listener = vi.fn();
    recorder.onRuntimeFault(listener); await recorder.prepare({ audioRoot: media }); recorder.activate(); recorder.startIfReady(0);
    const pipeline = lastRecorder;
    recordingTrack().mute(); recordingTrack().mute(); recorder.pause(100);
    expect(listener).toHaveBeenCalledExactlyOnceWith({ reason: 'AUDIO_TRACK_MUTED', recoverability: 'SAME_PIPELINE_RECOVERABLE', state: 'WAITING_FOR_USER' });
    expect(recorder.snapshot().state).toBe('INTERRUPTED'); expect((recorder.runtimeFault()?.state === 'RECOVERED_WAITING_FOR_USER')).toBe(false);
    expect(recorder.recoverRuntime()).toBe(false); recordingTrack().unmute();
    expect(listener).toHaveBeenLastCalledWith({ reason: 'AUDIO_TRACK_MUTED', recoverability: 'SAME_PIPELINE_RECOVERABLE', state: 'RECOVERED_WAITING_FOR_USER' });
    expect((recorder.runtimeFault()?.state === 'RECOVERED_WAITING_FOR_USER')).toBe(true); expect(recorder.snapshot().state).toBe('INTERRUPTED');
    expect(recorder.recoverRuntime()).toBe(true); recorder.resume(100);
    expect(recorder.snapshot().state).toBe('RECORDING'); expect(lastRecorder).toBe(pipeline);
    await recorder.freeze(200); expect((await recorder.finalize()).status).toBe('READY'); await recorder.stopAndCleanup();
  });
  for (const event of ['ended', 'error'] as const) it(`${event} requires restart or explicit degradation, never fake recovery`, async () => {
    const track = createTrack(), media = createStream([track]);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => media) } });
    const recorder = new PerformanceRecorder('AUDIO', memoryRecordingSinkFactory), listener = vi.fn(); recorder.onRuntimeFault(listener);
    await recorder.prepare({ audioRoot: media }); recorder.activate(); recorder.startIfReady(0);
    if (event === 'ended') recordingTrack().end(); else lastRecorder!.onerror!();
    lastRecorder!.onerror!(); recordingTrack().end();
    expect(listener).toHaveBeenCalledOnce(); expect(recorder.runtimeFault()?.recoverability).toBe('RESTART_REQUIRED');
    expect((recorder.runtimeFault()?.state === 'RECOVERED_WAITING_FOR_USER')).toBe(false); expect(recorder.recoverRuntime()).toBe(false);
    expect(recorder.snapshot().state).toBe('INTERRUPTED'); await expect(recorder.finalize()).rejects.toThrow('RECORDING_DECISION_REQUIRED');
    await recorder.continueWithoutRecording(); expect(recorder.snapshot().state).toBe('UNAVAILABLE');
    await recorder.freeze(10); expect(await recorder.finalize()).toEqual({ status: 'UNAVAILABLE', reason: event === 'ended' ? 'AUDIO_TRACK_ENDED' : 'MEDIA_RECORDER_ERROR' });
    expect(recordingTrack().stop).toHaveBeenCalledOnce(); await recorder.stopAndCleanup(); recordingTrack().mute(); expect(listener).toHaveBeenCalledOnce();
  });
  it('escalates an unresolved mute to hard failure without publishing duplicate incidents', async () => {
    const track = createTrack(); Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => createStream([track]) } });
    const recorder = new PerformanceRecorder('AUDIO', memoryRecordingSinkFactory), listener = vi.fn(); recorder.onRuntimeFault(listener);
    await recorder.prepare({ audioRoot: createStream() }); recorder.activate(); recorder.startIfReady(0);
    recordingTrack().mute(); recordingTrack().end(); expect(listener).toHaveBeenCalledTimes(2);
    recordingTrack().end(); expect(listener).toHaveBeenCalledTimes(2);
    expect(recorder.runtimeFault()).toEqual({ reason: 'AUDIO_TRACK_MUTED', recoverability: 'RESTART_REQUIRED', state: 'WAITING_FOR_USER' });
    expect(recorder.recoverRuntime()).toBe(false); await recorder.stopAndCleanup();
  });

  for (const operation of ['pause', 'resume'] as const) it(`${operation} failure is a hard runtime incident, never silent degradation`, async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => createStream() } });
    const recorder = new PerformanceRecorder('AUDIO', memoryRecordingSinkFactory), listener = vi.fn(); recorder.onRuntimeFault(listener);
    await recorder.prepare({ audioRoot: createStream() }); recorder.activate(); recorder.startIfReady(0);
    if (operation === 'pause') behavior.throwOnPause = true;
    recorder.pause(10);
    if (operation === 'resume') { behavior.throwOnResume = true; recorder.resume(10); }
    expect(listener).toHaveBeenCalledExactlyOnceWith({ reason: operation === 'pause' ? 'RECORDER_PAUSE_FAILED' : 'RECORDER_RESUME_FAILED', recoverability: 'RESTART_REQUIRED', state: 'WAITING_FOR_USER' });
    expect(recorder.snapshot().state).toBe('INTERRUPTED'); expect(recorder.recoverRuntime()).toBe(false); await recorder.stopAndCleanup();
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(globalThis, 'MediaRecorder', {
      configurable: true,
      writable: true,
      value: originalMediaRecorder,
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: originalMediaDevices,
    });
  });

  it('returns NOT_RECORDED when recording is OFF', async () => {
    const recorder = new PerformanceRecorder('OFF', memoryRecordingSinkFactory);
    await recorder.prepare({ audioRoot: createStream() });
    recorder.startIfReady(0);
    await recorder.freeze(1000);

    const result = await recorder.finalize();

    expect(result.status).toBe('NOT_RECORDED');
    expect(Object.keys(result)).toEqual(['status']);
  });

  it('owns a recorder clone, never acquires or stops the session root', async () => {
    const rootTrack = createTrack(), clonedTrack = createTrack();
    const root = createStream([rootTrack]), clone = createStream([clonedTrack]);
    vi.spyOn(root, 'clone').mockReturnValue(clone);
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    const recorder = new PerformanceRecorder('AUDIO', memoryRecordingSinkFactory);
    await recorder.prepare({ audioRoot: root });
    expect(recorder.snapshot().sourceOwnership).toBe('OWNED_CLONE');
    await recorder.stopAndCleanup(); await recorder.stopAndCleanup();
    expect(clonedTrack.stop).toHaveBeenCalledTimes(1); expect(rootTrack.stop).not.toHaveBeenCalled(); expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('includes final recorder data before marking audio READY', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => createStream()) },
    });
    const recorder = new PerformanceRecorder('AUDIO', memoryRecordingSinkFactory);
    await recorder.prepare({ audioRoot: createStream() });
    recorder.startIfReady(0);
    await recorder.freeze(1200);

    const result = await recorder.finalize();

    expect(result.status).toBe('READY');
    if (result.status === 'READY') {
      expect(result.kind).toBe('AUDIO');
      expect(result.timebase.nominalMediaDurationUs).toBe(1200000);
      expect(result.media.blob.size).toBeGreaterThan(0);
      expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.timebase)).toBe(true);
      expect(Object.isFrozen(result.timebase.activeSegments)).toBe(true); expect(Object.isFrozen(result.timebase.activeSegments[0])).toBe(true);
    }
  });

  it('keeps pause duration out of the recording timebase', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => createStream()) },
    });
    const recorder = new PerformanceRecorder('AUDIO', memoryRecordingSinkFactory);
    await recorder.prepare({ audioRoot: createStream() });
    recorder.startIfReady(0);
    recorder.pause(500);
    recorder.resume(900);
    await recorder.freeze(1400);

    const result = await recorder.finalize();

    expect(result.status).toBe('READY');
    if (result.status !== 'READY') throw new Error('Expected ready recording');
    expect(result.timebase.activeSegments).toEqual([
      { performanceStartUs: 0, performanceEndUs: 500000, mediaStartUs: 0, mediaEndUs: 500000 },
      { performanceStartUs: 900000, performanceEndUs: 1400000, mediaStartUs: 500000, mediaEndUs: 1000000 },
    ]);
    expect(result.timebase.nominalMediaDurationUs).toBe(1000000);
  });

  it('quantizes runtime boundaries once and skips zero-duration intervals', async () => {
    const recorder = new PerformanceRecorder('AUDIO', memoryRecordingSinkFactory);
    await recorder.prepare({ audioRoot: createStream() });
    recorder.startIfReady(0.0004);
    recorder.pause(0.00049);
    recorder.resume(0.1005);
    recorder.pause(0.2005);
    recorder.resume(0.3005);
    await recorder.freeze(0.4005);
    const result = await recorder.finalize();
    expect(result.status).toBe('READY');
    if(result.status !== 'READY') throw new Error('Expected recording');
    expect(result.timebase).toEqual({
      nominalMediaDurationUs: 200, activeSegments: [
        { performanceStartUs: 101, performanceEndUs: 201, mediaStartUs: 0, mediaEndUs: 100 },
        { performanceStartUs: 301, performanceEndUs: 401, mediaStartUs: 100, mediaEndUs: 200 },
      ]
    });
    await result.media.release();
  });

  it('does not publish READY when every active interval quantizes to zero', async () => {
    const recorder = new PerformanceRecorder('AUDIO', memoryRecordingSinkFactory);
    await recorder.prepare({ audioRoot: createStream() });
    recorder.startIfReady(0);
    await recorder.freeze(0.0004);
    expect(await recorder.finalize()).toEqual({ status: 'UNAVAILABLE', reason: 'EMPTY_RECORDING_BLOB' });
  });

  it.each(['missing', 'empty', 'dead', 'invalid-clone'])('rejects %s session audio and never stops a borrowed root', async fault => {
    const rootTrack = createTrack(), cloneTrack = createTrack();
    const root = createStream(fault === 'empty' ? [] : [rootTrack]);
    if (fault === 'dead') rootTrack.readyState = 'ended';
    if (fault === 'invalid-clone') { cloneTrack.readyState = 'ended'; vi.spyOn(root, 'clone').mockReturnValue(createStream([cloneTrack])); }
    const recorder = new PerformanceRecorder('AUDIO', memoryRecordingSinkFactory);
    await expect(recorder.prepare({ audioRoot: fault === 'missing' ? null : root }))
      .rejects.toThrow('RECORDING_AUDIO_UNAVAILABLE');
    expect(rootTrack.stop).not.toHaveBeenCalled();
    if (fault === 'invalid-clone') expect(cloneTrack.stop).toHaveBeenCalledOnce();
    expect(recorder.snapshot().sourceOwnership).toBe('NONE'); expect(lastRecorder).toBeNull();
  });

  it.each(['missing-audio', 'missing-video', 'dead-audio', 'dead-video'])('VIDEO rejects %s before cloning or constructing a recorder', async fault => {
    const audio = createTrack(), video = createTrack('video');
    if (fault === 'dead-audio') audio.readyState = 'ended';
    if (fault === 'dead-video') video.readyState = 'ended';
    const root = createStream(fault === 'missing-audio' ? [video] : fault === 'missing-video' ? [audio] : [audio, video]);
    const clone = vi.spyOn(root, 'clone'), recorder = new PerformanceRecorder('VIDEO', memoryRecordingSinkFactory);
    await expect(recorder.prepare({ audioRoot: root, cameraStream: root })).rejects.toThrow(
      fault.includes('audio') ? 'RECORDING_AUDIO_UNAVAILABLE' : 'RECORDING_VIDEO_UNAVAILABLE');
    expect(clone).not.toHaveBeenCalled(); expect(lastRecorder).toBeNull();
    expect(audio.stop).not.toHaveBeenCalled(); expect(video.stop).not.toHaveBeenCalled();
  });

  it('rejects unsupported recorder or video MIME without acquiring recording microphone', async () => {
    const acquire = vi.fn(); Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: acquire } });
    Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: undefined });
    await expect(new PerformanceRecorder('AUDIO', memoryRecordingSinkFactory).prepare({ audioRoot: createStream() })).rejects.toThrow('MEDIA_RECORDER_UNSUPPORTED');
    Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: class { static isTypeSupported() { return false; } } });
    await expect(new PerformanceRecorder('VIDEO', memoryRecordingSinkFactory).prepare({ audioRoot: createStream() })).rejects.toThrow('VIDEO_RECORDER_UNSUPPORTED');
    expect(acquire).not.toHaveBeenCalled();
  });

  it('constructor failure releases its clone and retains the borrowed root', async () => {
    const rootTrack = createTrack(), cloneTrack = createTrack(), root = createStream([rootTrack]);
    vi.spyOn(root, 'clone').mockReturnValue(createStream([cloneTrack]));
    Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: class { constructor() { throw new Error('private URL/stack detail'); } } });
    const recorder = new PerformanceRecorder('AUDIO', memoryRecordingSinkFactory);
    await expect(recorder.prepare({ audioRoot: root })).rejects.toThrow('RECORDER_INIT_FAILED');
    expect(cloneTrack.stop).toHaveBeenCalledOnce(); expect(rootTrack.stop).not.toHaveBeenCalled();
    expect(recorder.snapshot().sourceOwnership).toBe('NONE'); await recorder.stopAndCleanup(); expect(cloneTrack.stop).toHaveBeenCalledOnce();
  });

  it('rechecks live prepared resources at the transport admission boundary', async () => {
    const track = createTrack();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => createStream([track]) } });
    const recorder = new PerformanceRecorder('AUDIO', memoryRecordingSinkFactory);
    await recorder.prepare({ audioRoot: createStream([track]) }); recordingTrack().readyState = 'ended';
    expect(() => recorder.assertPrepared()).toThrow('RECORDING_AUDIO_UNAVAILABLE');
    await recorder.stopAndCleanup(); expect(recordingTrack().stop).toHaveBeenCalledOnce();
  });

  it('post-start recorder errors still produce unavailable media', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => createStream() } });
    const recorder = new PerformanceRecorder('AUDIO', memoryRecordingSinkFactory); await recorder.prepare({ audioRoot: createStream() });
    recorder.startIfReady(0); lastRecorder!.onerror!();
    expect(recorder.snapshot().state).toBe('INTERRUPTED'); await recorder.continueWithoutRecording(); await recorder.freeze(1000);
    expect(await recorder.finalize()).toEqual({ status: 'UNAVAILABLE', reason: 'MEDIA_RECORDER_ERROR' });
    await recorder.stopAndCleanup();
  });

  it('fails closed when recorder stop times out', async () => {
    vi.useFakeTimers();
    behavior.emitStop = false;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => createStream()) },
    });
    const recorder = new PerformanceRecorder('AUDIO', memoryRecordingSinkFactory);
    await recorder.prepare({ audioRoot: createStream() });
    recorder.startIfReady(0);

    const freeze = recorder.freeze(800);
    await vi.advanceTimersByTimeAsync(1500);
    await freeze;
    const result = await recorder.finalize();

    expect(result).toEqual({ status: 'UNAVAILABLE', reason: 'RECORDER_STOP_TIMEOUT' });
  });

  it('successful admission and Start can still complete with unavailable empty final media', async () => {
    behavior.emitData = false;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => createStream() } });
    const recorder = new PerformanceRecorder('AUDIO', memoryRecordingSinkFactory);
    await recorder.prepare({ audioRoot: createStream() }); recorder.startIfReady(0); await recorder.freeze(1000);
    expect(await recorder.finalize()).toEqual({ status: 'UNAVAILABLE', reason: 'EMPTY_RECORDING_BLOB' });
    await recorder.stopAndCleanup();
  });

  it('reports UNAVAILABLE when a track ends before finalization completes', async () => {
    const track = createTrack('audio');
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => createStream([track])) },
    });
    const recorder = new PerformanceRecorder('AUDIO', memoryRecordingSinkFactory);
    await recorder.prepare({ audioRoot: createStream([track]) });
    recorder.startIfReady(0);
    recordingTrack().end();
    expect(recorder.snapshot().state).toBe('INTERRUPTED'); await recorder.continueWithoutRecording();
    await recorder.freeze(100);

    const result = await recorder.finalize();

    expect(result).toEqual({ status: 'UNAVAILABLE', reason: 'AUDIO_TRACK_ENDED' });
  });

  it('stops each recorder clone once and never either borrowed root', async () => {
    for (const source of ['input', 'recording']) {
      const rootTrack = createTrack(), cloneTrack = createTrack(), root = createStream([rootTrack]);
      vi.spyOn(root, 'clone').mockReturnValue(createStream([cloneTrack]));
      const recorder = new PerformanceRecorder('AUDIO', memoryRecordingSinkFactory); await recorder.prepare({ audioRoot: root });
      await recorder.stopAndCleanup(); await recorder.stopAndCleanup();
      expect(cloneTrack.stop, source).toHaveBeenCalledOnce(); expect(rootTrack.stop, source).not.toHaveBeenCalled();
    }
  });
});
