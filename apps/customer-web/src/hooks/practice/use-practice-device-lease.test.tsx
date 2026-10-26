// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { browserDevicePlatform } from '@/lib/practice/device/browser-device-platform';
import { usePracticeDeviceLease } from './use-practice-device-lease';

const configuration = { mode: 'CONTINUOUS_PLAY', inputSource: 'MICROPHONE', recordingMode: 'VIDEO' } as const;
afterEach(() => vi.restoreAllMocks());
function stream(kind: 'audio' | 'video') {
  const track = Object.assign(new EventTarget(), { kind, readyState: 'live', muted: false, stop: vi.fn() });
  return { track, media: { getTracks: () => [track], getAudioTracks: () => kind === 'audio' ? [track] : [],
    getVideoTracks: () => kind === 'video' ? [track] : [] } as unknown as MediaStream };
}
it('page binding stays stable through rerenders, renews only the failed root, and stops all roots on unmount', async () => {
  const input = stream('audio'), camera = stream('video'), replacement = stream('video');
  const acquire = vi.spyOn(browserDevicePlatform, 'acquireStream').mockResolvedValueOnce(input.media).mockResolvedValueOnce(camera.media).mockResolvedValueOnce(replacement.media);
  const { result, rerender, unmount } = renderHook(() => usePracticeDeviceLease(configuration, true), { wrapper: StrictMode });
  await waitFor(() => expect(result.current.snapshot?.state).toBe('READY'));
  const roots = result.current.borrow(); rerender(); expect(result.current.borrow()).toEqual(roots); expect(acquire).toHaveBeenCalledTimes(2);
  act(() => { camera.track.readyState = 'ended'; camera.track.dispatchEvent(new Event('ended')); });
  expect(result.current.borrow()).toBeNull();
  await act(async () => { expect(await result.current.renewFailed()).toBe(true); });
  expect(result.current.borrow()).toMatchObject({ camera: replacement.media, inputMicrophone: input.media });
  expect(input.track.stop).not.toHaveBeenCalled(); expect(acquire).toHaveBeenCalledTimes(3);
  unmount(); expect(input.track.stop).toHaveBeenCalledOnce(); expect(camera.track.stop).toHaveBeenCalledOnce(); expect(replacement.track.stop).toHaveBeenCalledOnce();
});
it('a late camera acquisition after page departure is stopped without restoring the preview', async () => {
  const input = stream('audio'), camera = stream('video'); let release!: (media: MediaStream) => void;
  vi.spyOn(browserDevicePlatform, 'acquireStream').mockResolvedValueOnce(input.media).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const { unmount } = renderHook(() => usePracticeDeviceLease(configuration, true));
  await waitFor(() => expect(release).toBeTypeOf('function')); unmount();
  expect(input.track.stop).toHaveBeenCalledOnce();
  await act(async () => { release(camera.media); }); expect(camera.track.stop).toHaveBeenCalledOnce();
});

it('renewal failure publishes the lease error without admitting an attempt or rejecting the user action', async () => {
  const root = stream('audio'), camera = stream('video');
  const acquire = vi.spyOn(browserDevicePlatform, 'acquireStream').mockResolvedValueOnce(root.media).mockResolvedValueOnce(camera.media);
  const { result, unmount } = renderHook(() => usePracticeDeviceLease(configuration, true));
  await waitFor(() => expect(result.current.snapshot?.state).toBe('READY'));
  act(() => { camera.track.readyState = 'ended'; camera.track.dispatchEvent(new Event('ended')); });
  acquire.mockRejectedValueOnce(new DOMException('private detail', 'NotAllowedError'));
  await act(async () => { expect(await result.current.renewFailed()).toBe(false); });
  expect(result.current.snapshot).toMatchObject({ state: 'FAULTED', issue: { resource: 'camera', phase: 'OPEN', condition: 'PERMISSION_DENIED' } });
  expect(result.current.borrow()).toBeNull(); expect(root.track.stop).not.toHaveBeenCalled(); unmount();
});
