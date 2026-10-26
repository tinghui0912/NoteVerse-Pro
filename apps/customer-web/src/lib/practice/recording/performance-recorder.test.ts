// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PerformanceRecorder } from './performance-recorder';

type TrackListener = () => void;

function createTrack(kind: 'audio' | 'video' = 'audio') {
  const listeners: TrackListener[] = [];
  return {
    kind,
    readyState: 'live',
    stop: vi.fn(),
    addEventListener: vi.fn((event: string, listener: TrackListener) => {
      if (event === 'ended') listeners.push(listener);
    }),
    end() {
      listeners.forEach((listener) => listener());
    },
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
};

describe('PerformanceRecorder', () => {
  const originalMediaRecorder = globalThis.MediaRecorder;
  const originalMediaDevices = navigator.mediaDevices;
  let behavior: MockRecorderBehavior;
  let lastRecorder: { onerror: (() => void) | null } | null = null;

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

      constructor() { lastRecorder = this; }

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
        this.state = 'paused';
      }

      resume() {
        this.state = 'recording';
      }
    }
    Object.defineProperty(globalThis, 'MediaRecorder', {
      configurable: true,
      writable: true,
      value: MockMediaRecorder,
    });
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
    await recorder.prepare({ inputSource: 'MIDI' });
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
    await recorder.prepare({ inputSource: 'MICROPHONE', sessionMicrophoneStream: root });
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
    await recorder.prepare({ inputSource: 'MIDI' });
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
    await recorder.prepare({ inputSource: 'MIDI' });
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

  it.each(['NotAllowedError', 'NotFoundError', 'NotReadableError'])('rejects fresh microphone %s before admission without retaining resources', async name => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true,
      value: { getUserMedia: vi.fn(async () => { throw new DOMException('private browser detail', name); }) } });
    const recorder = new PerformanceRecorder('AUDIO');
    await expect(recorder.prepare({ inputSource: 'MIDI' })).rejects.toMatchObject({
      name: 'RecordingPreparationError', message: name === 'NotAllowedError' ? 'RECORDING_PERMISSION_DENIED' : 'RECORDING_AUDIO_UNAVAILABLE',
    });
    expect(recorder.snapshot()).toEqual({ state: 'PREPARATION_FAILED', sourceOwnership: 'NONE', unavailableReason: null });
    expect(lastRecorder).toBeNull();
    await expect(recorder.finalize()).rejects.toThrow('RECORDING_DISCARDED');
  });

  it.each(['missing', 'empty', 'dead', 'invalid-clone'])('rejects %s session audio and never stops a borrowed root', async fault => {
    const rootTrack = createTrack(), cloneTrack = createTrack();
    const root = createStream(fault === 'empty' ? [] : [rootTrack]);
    if (fault === 'dead') rootTrack.readyState = 'ended';
    if (fault === 'invalid-clone') { cloneTrack.readyState = 'ended'; vi.spyOn(root, 'clone').mockReturnValue(createStream([cloneTrack])); }
    const recorder = new PerformanceRecorder('AUDIO');
    await expect(recorder.prepare({ inputSource: 'MICROPHONE', sessionMicrophoneStream: fault === 'missing' ? null : root }))
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
    await expect(recorder.prepare({ inputSource: 'MIDI', cameraStream: root })).rejects.toThrow(
      fault.includes('audio') ? 'RECORDING_AUDIO_UNAVAILABLE' : 'RECORDING_VIDEO_UNAVAILABLE');
    expect(clone).not.toHaveBeenCalled(); expect(lastRecorder).toBeNull();
    expect(audio.stop).not.toHaveBeenCalled(); expect(video.stop).not.toHaveBeenCalled();
  });

  it('rejects unsupported recorder or video MIME without acquiring recording microphone', async () => {
    const acquire = vi.fn(); Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: acquire } });
    Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: undefined });
    await expect(new PerformanceRecorder('AUDIO').prepare({ inputSource: 'MIDI' })).rejects.toThrow('MEDIA_RECORDER_UNSUPPORTED');
    Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: class { static isTypeSupported() { return false; } } });
    await expect(new PerformanceRecorder('VIDEO').prepare({ inputSource: 'MIDI' })).rejects.toThrow('VIDEO_RECORDER_UNSUPPORTED');
    expect(acquire).not.toHaveBeenCalled();
  });

  it('constructor failure releases acquired audio and exposes only a stable preparation code', async () => {
    const track = createTrack();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => createStream([track]) } });
    Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: class { constructor() { throw new Error('private URL/stack detail'); } } });
    const recorder = new PerformanceRecorder('AUDIO');
    await expect(recorder.prepare({ inputSource: 'MIDI' })).rejects.toThrow('RECORDER_INIT_FAILED');
    expect(track.stop).toHaveBeenCalledOnce(); expect(recorder.snapshot().sourceOwnership).toBe('NONE');
    recorder.stopAndCleanup(); expect(track.stop).toHaveBeenCalledOnce();
  });

  it('rechecks live prepared resources at the transport admission boundary', async () => {
    const track = createTrack();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => createStream([track]) } });
    const recorder = new PerformanceRecorder('AUDIO');
    await recorder.prepare({ inputSource: 'MIDI' }); track.readyState = 'ended';
    expect(() => recorder.assertPrepared()).toThrow('RECORDING_AUDIO_UNAVAILABLE');
    recorder.stopAndCleanup(); expect(track.stop).toHaveBeenCalledOnce();
  });

  it('post-start recorder errors still produce unavailable media', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => createStream() } });
    const recorder = new PerformanceRecorder('AUDIO'); await recorder.prepare({ inputSource: 'MIDI' });
    recorder.startIfReady(0); lastRecorder!.onerror!(); await recorder.freeze(1000);
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
    await recorder.prepare({ inputSource: 'MIDI' });
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
    await recorder.prepare({ inputSource: 'MIDI' }); recorder.startIfReady(0); await recorder.freeze(1000);
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
    await recorder.prepare({ inputSource: 'MIDI' });
    recorder.startIfReady(0);
    track.end();
    await recorder.freeze(100);

    const result = await recorder.finalize();

    expect(result).toEqual({ status: 'UNAVAILABLE', reason: 'AUDIO_TRACK_ENDED' });
  });

  it('cleans up owned microphone tracks but leaves borrowed analysis tracks alone', async () => {
    const ownedTrack = createTrack('audio');
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => createStream([ownedTrack])) },
    });
    const ownedRecorder = new PerformanceRecorder('AUDIO');
    await ownedRecorder.prepare({ inputSource: 'MIDI' });
    ownedRecorder.stopAndCleanup();
    ownedRecorder.stopAndCleanup();
    expect(ownedTrack.stop).toHaveBeenCalledTimes(1);

    const borrowedTrack = createTrack('audio');
    const borrowedRecorder = new PerformanceRecorder('AUDIO');
    await borrowedRecorder.prepare({
      inputSource: 'MICROPHONE',
      sessionMicrophoneStream: createStream([borrowedTrack]),
    });
    borrowedRecorder.stopAndCleanup();
    expect(borrowedTrack.stop).not.toHaveBeenCalled();
  });
});
