import { planPracticeResources } from '@/lib/practice/planning/resource-plan';
// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { browserDevicePlatform } from '@/lib/practice/device/browser-device-platform';
import { usePracticeDeviceLease } from './use-practice-device-lease';

const resources = planPracticeResources({ mode: 'CONTINUOUS_PLAY', inputSource: 'MICROPHONE', recordingMode: 'VIDEO' });
afterEach(() => vi.restoreAllMocks());
function stream(kind: 'audio' | 'video') {
  const track = Object.assign(new EventTarget(), { kind, readyState: 'live', muted: false, stop: vi.fn() });
  return { track, media: { getTracks: () => [track], getAudioTracks: () => kind === 'audio' ? [track] : [],
    getVideoTracks: () => kind === 'video' ? [track] : [] } as unknown as MediaStream };
}
it('page binds once across rerenders and hard loss; only unmount releases retained roots', async () => {
  const input = stream('audio'), camera = stream('video');
  const acquire = vi.spyOn(browserDevicePlatform, 'acquireStream').mockResolvedValueOnce(input.media).mockResolvedValueOnce(camera.media);
  const { result, rerender, unmount } = renderHook(() => usePracticeDeviceLease(planPracticeResources({ mode: 'CONTINUOUS_PLAY', inputSource: 'MICROPHONE', recordingMode: 'VIDEO' }), true), { wrapper: StrictMode });
  await waitFor(() => expect(result.current.snapshot?.state).toBe('READY'));
  const roots = result.current.borrow(), port = result.current.rootHealth; rerender(); expect(result.current.rootHealth).toBe(port); expect(result.current.borrow()).toEqual(roots); expect(acquire).toHaveBeenCalledTimes(2);
  act(() => { camera.track.readyState = 'ended'; camera.track.dispatchEvent(new Event('ended')); });
  expect(result.current.borrow()).toBeNull();
  rerender();
  expect(result.current.snapshot?.state).toBe('FAULTED'); expect(result.current.borrow()).toBeNull();
  expect(input.track.stop).not.toHaveBeenCalled(); expect(acquire).toHaveBeenCalledTimes(2);
  expect(Object.keys(result.current).sort()).toEqual(['borrow', 'rootHealth', 'snapshot']);
  unmount(); expect(input.track.stop).toHaveBeenCalledOnce(); expect(camera.track.stop).toHaveBeenCalledOnce();
});
it('a late camera acquisition after page departure is stopped without restoring the preview', async () => {
  const input = stream('audio'), camera = stream('video'); let release!: (media: MediaStream) => void;
  vi.spyOn(browserDevicePlatform, 'acquireStream').mockResolvedValueOnce(input.media).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const { unmount } = renderHook(() => usePracticeDeviceLease(resources, true));
  await waitFor(() => expect(release).toBeTypeOf('function')); unmount();
  expect(input.track.stop).toHaveBeenCalledOnce();
  await act(async () => { release(camera.media); }); expect(camera.track.stop).toHaveBeenCalledOnce();
});

it('failed initial binding remains on the execution page without a reacquisition command', async () => {
  const acquire = vi.spyOn(browserDevicePlatform, 'acquireStream').mockRejectedValue(new DOMException('private detail', 'NotAllowedError'));
  const { result, rerender, unmount } = renderHook(() => usePracticeDeviceLease(resources, true));
  await waitFor(() => expect(result.current.snapshot?.state).toBe('FAULTED'));
  rerender();
  expect(result.current.snapshot?.issue).toMatchObject({ phase: 'OPEN', condition: 'PERMISSION_DENIED' });
  expect(result.current.borrow()).toBeNull(); expect(acquire).toHaveBeenCalledOnce();
  expect(Object.keys(result.current).sort()).toEqual(['borrow', 'rootHealth', 'snapshot']); unmount();
});
