// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  let lastRecorder: { stream: MediaStream; onerror: (() => void) | null } | null = null;

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

      constructor(readonly stream: MediaStream) { lastRecorder = this; }

      start() {
        this.state = 'recording';
      }

      requestData() {
        if (behavior.emitData) {
          this.ondataavailable?.({ data: new Blob(['final'], { type: 'audio/webm' }) });
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

  it('consumes physical audio facts without subscribing to the borrowed track, while retaining clone health', async () => {
    const physical = createTrack(), root = createStream([physical]), listen = vi.spyOn(physical, 'addEventListener');
    const recorder = new PerformanceRecorder('AUDIO'); await recorder.prepare({ audioRoot: root });
    recorder.observeSourceHealth({ audio: 'HEALTHY' }); recorder.activate(); recorder.startIfReady(0);
    expect(listen).not.toHaveBeenCalled(); expect(recordingTrack()).not.toBe(physical);
    physical.mute(); expect(recorder.runtimeFault()).toBeNull();
    recorder.observeSourceHealth({ audio: 'INTERRUPTED' }); recorder.pause(10);
    expect(recorder.runtimeFault()).toEqual({ reason: 'AUDIO_TRACK_MUTED', recoverability: 'SAME_PIPELINE_RECOVERABLE', state: 'WAITING_FOR_USER' });
    physical.unmute(); recorder.observeSourceHealth({ audio: 'HEALTHY' });
    expect(recorder.runtimeFault()?.state).toBe('RECOVERED_WAITING_FOR_USER'); expect(recorder.recoverRuntime()).toBe(true); recorder.resume(10);
    recordingTrack().end(); expect(recorder.runtimeFault()).toMatchObject({ reason: 'AUDIO_TRACK_ENDED', recoverability: 'RESTART_REQUIRED' });
    recorder.stopAndCleanup(); expect(physical.stop).not.toHaveBeenCalled();
  });
  it('applies the complete physical snapshot before publishing recording recovery', async () => {
    const root = createStream(), camera = createStream([createTrack('video')]);
    vi.stubGlobal('MediaStream', class { constructor(private tracks: MediaStreamTrack[]) {} getTracks() { return this.tracks; }
      getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); } getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
      clone() { return createStream(this.tracks.map(track => createTrack(track.kind as 'audio' | 'video'))); }
    });
    try {
      const recorder = new PerformanceRecorder('VIDEO'), faults = vi.fn();
      await recorder.prepare({ audioRoot: root, cameraStream: camera }); recorder.onRuntimeFault(faults);
      recorder.activate(); recorder.startIfReady(0);
      recorder.observeSourceHealth({ audio: 'INTERRUPTED', video: 'HEALTHY' }); recorder.pause(1);
      recorder.observeSourceHealth({ audio: 'HEALTHY', video: 'LOST' });
      expect(faults.mock.calls.every(([fact]) => fact.state === 'WAITING_FOR_USER')).toBe(true);
      expect(recorder.runtimeFault()?.recoverability).toBe('RESTART_REQUIRED'); recorder.stopAndCleanup();
    } finally { vi.unstubAllGlobals(); }
  });
  it.each(['AUDIO', 'VIDEO'] as const)('%s physical loss preserves source-specific hard failure meaning', async kind => {
    const root = createStream(), camera = createStream([createTrack('video')]);
    vi.stubGlobal('MediaStream', class { constructor(private tracks: MediaStreamTrack[]) {} getTracks() { return this.tracks; }
      getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); } getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
      clone() { return createStream(this.tracks.map(track => createTrack(track.kind as 'audio' | 'video'))); }
    });
    try {
      const recorder = new PerformanceRecorder('VIDEO'); await recorder.prepare({ audioRoot: root, cameraStream: camera });
      recorder.activate(); recorder.startIfReady(0); recorder.observeSourceHealth({ audio: kind === 'AUDIO' ? 'INTERRUPTED' : 'HEALTHY', video: kind === 'VIDEO' ? 'INTERRUPTED' : 'HEALTHY' }); recorder.pause(1);
      expect(recorder.runtimeFault()?.reason).toBe(kind === 'AUDIO' ? 'AUDIO_TRACK_MUTED' : 'VIDEO_TRACK_MUTED');
      recorder.observeSourceHealth({ audio: 'HEALTHY', video: 'HEALTHY' }); expect(recorder.runtimeFault()?.state).toBe('RECOVERED_WAITING_FOR_USER');
      expect(recorder.recoverRuntime()).toBe(true); recorder.resume(1); recorder.observeSourceHealth({ audio: kind === 'AUDIO' ? 'LOST' : 'HEALTHY', video: kind === 'VIDEO' ? 'LOST' : 'HEALTHY' });
      expect(recorder.runtimeFault()).toMatchObject({ reason: kind === 'AUDIO' ? 'AUDIO_TRACK_ENDED' : 'VIDEO_TRACK_ENDED', recoverability: 'RESTART_REQUIRED' });
      recorder.stopAndCleanup();
    } finally { vi.unstubAllGlobals(); }
  });
  it('publishes one recoverable mute incident and recovers only the same healthy pipeline', async () => {
    const track = createTrack(), media = createStream([track]);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => media) } });
    const recorder = new PerformanceRecorder('AUDIO'), listener = vi.fn();
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
    await recorder.freeze(200); expect((await recorder.finalize()).status).toBe('READY'); recorder.stopAndCleanup();
  });
  for (const event of ['ended', 'error'] as const) it(`${event} requires restart or explicit degradation, never fake recovery`, async () => {
    const track = createTrack(), media = createStream([track]);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => media) } });
    const recorder = new PerformanceRecorder('AUDIO'), listener = vi.fn(); recorder.onRuntimeFault(listener);
    await recorder.prepare({ audioRoot: media }); recorder.activate(); recorder.startIfReady(0);
    if (event === 'ended') recordingTrack().end(); else lastRecorder!.onerror!();
    lastRecorder!.onerror!(); recordingTrack().end();
    expect(listener).toHaveBeenCalledOnce(); expect(recorder.runtimeFault()?.recoverability).toBe('RESTART_REQUIRED');
    expect((recorder.runtimeFault()?.state === 'RECOVERED_WAITING_FOR_USER')).toBe(false); expect(recorder.recoverRuntime()).toBe(false);
    expect(recorder.snapshot().state).toBe('INTERRUPTED'); await expect(recorder.finalize()).rejects.toThrow('RECORDING_DECISION_REQUIRED');
    recorder.continueWithoutRecording(); expect(recorder.snapshot().state).toBe('UNAVAILABLE');
    await recorder.freeze(10); expect(await recorder.finalize()).toEqual({ status: 'UNAVAILABLE', reason: event === 'ended' ? 'AUDIO_TRACK_ENDED' : 'MEDIA_RECORDER_ERROR' });
    expect(recordingTrack().stop).toHaveBeenCalledOnce(); recorder.stopAndCleanup(); recordingTrack().mute(); expect(listener).toHaveBeenCalledOnce();
  });
  it('escalates an unresolved mute to hard failure without publishing duplicate incidents', async () => {
    const track = createTrack(); Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => createStream([track]) } });
    const recorder = new PerformanceRecorder('AUDIO'), listener = vi.fn(); recorder.onRuntimeFault(listener);
    await recorder.prepare({ audioRoot: createStream() }); recorder.activate(); recorder.startIfReady(0);
    recordingTrack().mute(); recordingTrack().end(); expect(listener).toHaveBeenCalledTimes(2);
    recordingTrack().end(); expect(listener).toHaveBeenCalledTimes(2);
    expect(recorder.runtimeFault()).toEqual({ reason: 'AUDIO_TRACK_MUTED', recoverability: 'RESTART_REQUIRED', state: 'WAITING_FOR_USER' });
    expect(recorder.recoverRuntime()).toBe(false); recorder.stopAndCleanup();
  });

  for (const operation of ['pause', 'resume'] as const) it(`${operation} failure is a hard runtime incident, never silent degradation`, async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => createStream() } });
    const recorder = new PerformanceRecorder('AUDIO'), listener = vi.fn(); recorder.onRuntimeFault(listener);
    await recorder.prepare({ audioRoot: createStream() }); recorder.activate(); recorder.startIfReady(0);
    if (operation === 'pause') behavior.throwOnPause = true;
    recorder.pause(10);
    if (operation === 'resume') { behavior.throwOnResume = true; recorder.resume(10); }
    expect(listener).toHaveBeenCalledExactlyOnceWith({ reason: operation === 'pause' ? 'RECORDER_PAUSE_FAILED' : 'RECORDER_RESUME_FAILED', recoverability: 'RESTART_REQUIRED', state: 'WAITING_FOR_USER' });
    expect(recorder.snapshot().state).toBe('INTERRUPTED'); expect(recorder.recoverRuntime()).toBe(false); recorder.stopAndCleanup();
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
    const recorder = new PerformanceRecorder('OFF');
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
    const recorder = new PerformanceRecorder('AUDIO');
    await recorder.prepare({ audioRoot: root });
    expect(recorder.snapshot().sourceOwnership).toBe('OWNED_CLONE');
    recorder.stopAndCleanup(); recorder.stopAndCleanup();
    expect(clonedTrack.stop).toHaveBeenCalledTimes(1); expect(rootTrack.stop).not.toHaveBeenCalled(); expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('includes final recorder data before marking audio READY', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => createStream()) },
    });
    const recorder = new PerformanceRecorder('AUDIO');
    await recorder.prepare({ audioRoot: createStream() });
    recorder.startIfReady(0);
    await recorder.freeze(1200);

    const result = await recorder.finalize();

    expect(result.status).toBe('READY');
    if (result.status === 'READY') {
      expect(result.kind).toBe('AUDIO');
      expect(result.durationMs).toBe(1200);
      expect(result.blob.size).toBeGreaterThan(0);
      expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.timebase)).toBe(true);
      expect(Object.isFrozen(result.timebase.activeSegments)).toBe(true); expect(Object.isFrozen(result.timebase.activeSegments[0])).toBe(true);
    }
  });

  it('keeps pause duration out of the recording timebase', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => createStream()) },
    });
    const recorder = new PerformanceRecorder('AUDIO');
    await recorder.prepare({ audioRoot: createStream() });
    recorder.startIfReady(0);
    recorder.pause(500);
    recorder.resume(900);
    await recorder.freeze(1400);

    const result = await recorder.finalize();

    expect(result.status).toBe('READY');
    if (result.status !== 'READY') throw new Error('Expected ready recording');
    expect(result.timebase.activeSegments).toEqual([
      { perfStartMs: 0, perfEndMs: 500, mediaStartMs: 0, mediaEndMs: 500 },
      { perfStartMs: 900, perfEndMs: 1400, mediaStartMs: 500, mediaEndMs: 1000 },
    ]);
    expect(result.timebase.nominalMediaDurationMs).toBe(1000);
  });

  it.each(['missing', 'empty', 'dead', 'invalid-clone'])('rejects %s session audio and never stops a borrowed root', async fault => {
    const rootTrack = createTrack(), cloneTrack = createTrack();
    const root = createStream(fault === 'empty' ? [] : [rootTrack]);
    if (fault === 'dead') rootTrack.readyState = 'ended';
    if (fault === 'invalid-clone') { cloneTrack.readyState = 'ended'; vi.spyOn(root, 'clone').mockReturnValue(createStream([cloneTrack])); }
    const recorder = new PerformanceRecorder('AUDIO');
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
    const clone = vi.spyOn(root, 'clone'), recorder = new PerformanceRecorder('VIDEO');
    await expect(recorder.prepare({ audioRoot: root, cameraStream: root })).rejects.toThrow(
      fault.includes('audio') ? 'RECORDING_AUDIO_UNAVAILABLE' : 'RECORDING_VIDEO_UNAVAILABLE');
    expect(clone).not.toHaveBeenCalled(); expect(lastRecorder).toBeNull();
    expect(audio.stop).not.toHaveBeenCalled(); expect(video.stop).not.toHaveBeenCalled();
  });

  it('rejects unsupported recorder or video MIME without acquiring recording microphone', async () => {
    const acquire = vi.fn(); Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: acquire } });
    Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: undefined });
    await expect(new PerformanceRecorder('AUDIO').prepare({ audioRoot: createStream() })).rejects.toThrow('MEDIA_RECORDER_UNSUPPORTED');
    Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: class { static isTypeSupported() { return false; } } });
    await expect(new PerformanceRecorder('VIDEO').prepare({ audioRoot: createStream() })).rejects.toThrow('VIDEO_RECORDER_UNSUPPORTED');
    expect(acquire).not.toHaveBeenCalled();
  });

  it('constructor failure releases its clone and retains the borrowed root', async () => {
    const rootTrack = createTrack(), cloneTrack = createTrack(), root = createStream([rootTrack]);
    vi.spyOn(root, 'clone').mockReturnValue(createStream([cloneTrack]));
    Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: class { constructor() { throw new Error('private URL/stack detail'); } } });
    const recorder = new PerformanceRecorder('AUDIO');
    await expect(recorder.prepare({ audioRoot: root })).rejects.toThrow('RECORDER_INIT_FAILED');
    expect(cloneTrack.stop).toHaveBeenCalledOnce(); expect(rootTrack.stop).not.toHaveBeenCalled();
    expect(recorder.snapshot().sourceOwnership).toBe('NONE'); recorder.stopAndCleanup(); expect(cloneTrack.stop).toHaveBeenCalledOnce();
  });

  it('rechecks live prepared resources at the transport admission boundary', async () => {
    const track = createTrack();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => createStream([track]) } });
    const recorder = new PerformanceRecorder('AUDIO');
    await recorder.prepare({ audioRoot: createStream([track]) }); recordingTrack().readyState = 'ended';
    expect(() => recorder.assertPrepared()).toThrow('RECORDING_AUDIO_UNAVAILABLE');
    recorder.stopAndCleanup(); expect(recordingTrack().stop).toHaveBeenCalledOnce();
  });

  it('post-start recorder errors still produce unavailable media', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => createStream() } });
    const recorder = new PerformanceRecorder('AUDIO'); await recorder.prepare({ audioRoot: createStream() });
    recorder.startIfReady(0); lastRecorder!.onerror!();
    expect(recorder.snapshot().state).toBe('INTERRUPTED'); recorder.continueWithoutRecording(); await recorder.freeze(1000);
    expect(await recorder.finalize()).toEqual({ status: 'UNAVAILABLE', reason: 'MEDIA_RECORDER_ERROR' });
    recorder.stopAndCleanup();
  });

  it('fails closed when recorder stop times out', async () => {
    vi.useFakeTimers();
    behavior.emitStop = false;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => createStream()) },
    });
    const recorder = new PerformanceRecorder('AUDIO');
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
    const recorder = new PerformanceRecorder('AUDIO');
    await recorder.prepare({ audioRoot: createStream() }); recorder.startIfReady(0); await recorder.freeze(1000);
    expect(await recorder.finalize()).toEqual({ status: 'UNAVAILABLE', reason: 'EMPTY_RECORDING_BLOB' });
    recorder.stopAndCleanup();
  });

  it('reports UNAVAILABLE when a track ends before finalization completes', async () => {
    const track = createTrack('audio');
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => createStream([track])) },
    });
    const recorder = new PerformanceRecorder('AUDIO');
    await recorder.prepare({ audioRoot: createStream([track]) });
    recorder.startIfReady(0);
    recordingTrack().end();
    expect(recorder.snapshot().state).toBe('INTERRUPTED'); recorder.continueWithoutRecording();
    await recorder.freeze(100);

    const result = await recorder.finalize();

    expect(result).toEqual({ status: 'UNAVAILABLE', reason: 'AUDIO_TRACK_ENDED' });
  });

  it('stops each recorder clone once and never either borrowed root', async () => {
    for (const source of ['input', 'recording']) {
      const rootTrack = createTrack(), cloneTrack = createTrack(), root = createStream([rootTrack]);
      vi.spyOn(root, 'clone').mockReturnValue(createStream([cloneTrack]));
      const recorder = new PerformanceRecorder('AUDIO'); await recorder.prepare({ audioRoot: root });
      recorder.stopAndCleanup(); recorder.stopAndCleanup();
      expect(cloneTrack.stop, source).toHaveBeenCalledOnce(); expect(rootTrack.stop, source).not.toHaveBeenCalled();
    }
  });
});
