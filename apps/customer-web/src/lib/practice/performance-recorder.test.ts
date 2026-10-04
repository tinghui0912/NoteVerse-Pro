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

  beforeEach(() => {
    behavior = { emitStop: true, emitData: true };
    class MockMediaRecorder {
      state: 'inactive' | 'recording' | 'paused' = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;

      constructor() {}

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

    expect(result.media.status).toBe('NOT_RECORDED');
    expect(result.timebase.nominalMediaDurationMs).toBe(0);
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

    expect(result.media.status).toBe('READY');
    if (result.media.status === 'READY') {
      expect(result.media.kind).toBe('AUDIO');
      expect(result.media.durationMs).toBe(1200);
      expect(result.media.blob.size).toBeGreaterThan(0);
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

    expect(result.media.status).toBe('READY');
    expect(result.timebase.activeSegments).toEqual([
      { perfStartMs: 0, perfEndMs: 500, mediaStartMs: 0, mediaEndMs: 500 },
      { perfStartMs: 900, perfEndMs: 1400, mediaStartMs: 500, mediaEndMs: 1000 },
    ]);
    expect(result.timebase.nominalMediaDurationMs).toBe(1000);
  });

  it('reports UNAVAILABLE when microphone permission is denied', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => { throw new DOMException('denied', 'NotAllowedError'); }) },
    });
    const recorder = new PerformanceRecorder('AUDIO');
    await recorder.prepare({ inputSource: 'MIDI' });
    const result = await recorder.finalize();

    expect(result.media).toEqual({ status: 'UNAVAILABLE', reason: 'NotAllowedError' });
  });

  it('preserves the original prepare failure reason across freeze/finalize', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => { throw new DOMException('denied', 'NotAllowedError'); }) },
    });
    const recorder = new PerformanceRecorder('AUDIO');
    await recorder.prepare({ inputSource: 'MIDI' });
    await recorder.freeze(1000);
    const result = await recorder.finalize();

    expect(result.media).toEqual({ status: 'UNAVAILABLE', reason: 'NotAllowedError' });
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

    expect(result.media).toEqual({ status: 'UNAVAILABLE', reason: 'RECORDER_STOP_TIMEOUT' });
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

    expect(result.media).toEqual({ status: 'UNAVAILABLE', reason: 'AUDIO_TRACK_ENDED' });
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
      analysisStream: createStream([borrowedTrack]),
    });
    borrowedRecorder.stopAndCleanup();
    expect(borrowedTrack.stop).not.toHaveBeenCalled();
  });
});
