// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PracticeInputSource, PracticeMode } from '@/lib/practice/local-core/artifact';
import { usePracticeCameraRecording } from './use-practice-camera-recording';

const messages = { continuousOnly: 'Continuous only', unsupported: 'Unsupported', preparing: 'Preparing',
  ready: 'Ready', permissionDenied: 'Permission denied', unavailable: 'Unavailable',
  audioMissing: 'Audio missing', videoMissing: 'Video missing' };
const options = { practiceMode: 'CONTINUOUS_PLAY' as PracticeMode, inputSource: 'MIDI' as PracticeInputSource, messages };

function cameraStream() {
  const tracks = ['video', 'audio'].map(kind => ({ kind, readyState: 'live', stop: vi.fn() }));
  const stream = { getTracks: () => tracks, getVideoTracks: () => [tracks[0]], getAudioTracks: () => [tracks[1]] } as unknown as MediaStream;
  return { stream, tracks };
}

async function settleInvalidation() {
  await act(async () => { vi.runOnlyPendingTimers(); });
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('installs a successful MIDI VIDEO stream and releases it without clearing its status', async () => {
  vi.useFakeTimers();
  const { stream, tracks } = cameraStream(), acquire = vi.fn().mockResolvedValue(stream);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: acquire } });
  const { result, unmount } = renderHook(() => usePracticeCameraRecording(options));
  await settleInvalidation();
  await act(async () => { await result.current.changeRecordingMode('VIDEO'); });
  expect(acquire).toHaveBeenCalledExactlyOnceWith({ video: { facingMode: 'user' },
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  expect(result.current).toMatchObject({ recordingMode: 'VIDEO', cameraPreviewStream: stream,
    cameraStatusMessage: messages.ready, isPreparingCamera: false });
  act(() => result.current.releaseCameraPreview());
  expect(result.current).toMatchObject({ recordingMode: 'OFF', cameraPreviewStream: null,
    cameraStatusMessage: messages.ready, isPreparingCamera: false });
  tracks.forEach(track => expect(track.stop).toHaveBeenCalled());
  await act(async () => { await result.current.changeRecordingMode('AUDIO'); });
  expect(result.current.recordingMode).toBe('AUDIO');
  expect(result.current.cameraStatusMessage).toBeNull();
  expect(acquire).toHaveBeenCalledOnce();
  unmount();
});

it.each(['input', 'mode'] as const)('keeps a pending camera result stale after %s invalidation', async change => {
  vi.useFakeTimers();
  let resolve!: (stream: MediaStream) => void;
  const pending = new Promise<MediaStream>(done => { resolve = done; });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockReturnValue(pending) } });
  const { result, rerender, unmount } = renderHook(props => usePracticeCameraRecording(props), { initialProps: options });
  await settleInvalidation();
  let selecting!: Promise<void>;
  act(() => { selecting = result.current.changeRecordingMode('VIDEO'); });
  expect(result.current.isPreparingCamera).toBe(true);
  rerender(change === 'input' ? { ...options, inputSource: 'MICROPHONE' } : { ...options, practiceMode: 'STEP_BY_STEP' });
  // Preserve the deferred invalidation boundary rather than treating the prop change as synchronous cleanup.
  expect(result.current.isPreparingCamera).toBe(true);
  await settleInvalidation();
  expect(result.current).toMatchObject({ recordingMode: 'OFF', cameraPreviewStream: null,
    cameraStatusMessage: null, isPreparingCamera: false });
  const { stream, tracks } = cameraStream();
  await act(async () => { resolve(stream); await selecting; });
  expect(result.current).toMatchObject({ recordingMode: 'OFF', cameraPreviewStream: null,
    cameraStatusMessage: null, isPreparingCamera: false });
  tracks.forEach(track => expect(track.stop).toHaveBeenCalledOnce());
  unmount();
});

it('stops the owned preview when the hook unmounts', async () => {
  vi.useFakeTimers();
  const { stream, tracks } = cameraStream();
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) } });
  const { result, unmount } = renderHook(() => usePracticeCameraRecording(options));
  await settleInvalidation();
  await act(async () => { await result.current.changeRecordingMode('VIDEO'); });
  tracks.forEach(track => expect(track.stop).not.toHaveBeenCalled());
  unmount();
  tracks.forEach(track => expect(track.stop).toHaveBeenCalledOnce());
});
