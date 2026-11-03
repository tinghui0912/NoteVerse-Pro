// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { downloadRecordingMedia } from './download-recording-media';
import { recordingSinkFixture } from '../__fixtures__/recording-sink';
import type { PerformanceRecording } from './recording-artifact';

beforeEach(() => { vi.stubGlobal('URL', { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() }); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it.each(['video/webm', 'video/mp4'])('retains the same %s source until its object URL is revoked', async mimeType => {
  vi.useFakeTimers(); const f = recordingSinkFixture(); await f.sink.append(new Blob(['raw']));
  const media = await f.sink.seal(mimeType);
  const recording: Extract<PerformanceRecording, { status: 'READY' }> = {
    blob: media.blob, resource: media.resource, status: 'READY', kind: 'VIDEO', mimeType, durationMs: 100,
    timebase: { nominalMediaDurationMs: 100, activeSegments: [{ perfStartMs: 0, perfEndMs: 100, mediaStartMs: 0, mediaEndMs: 100 }] },
  };
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:raw-file');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const pending = downloadRecordingMedia(recording, `capture.${mimeType.endsWith('mp4') ? 'mp4' : 'webm'}`);
  expect(create).toHaveBeenCalledExactlyOnceWith(media.blob); expect(click).toHaveBeenCalledOnce();
  await media.resource.release(); expect(f.exists()).toBe(true); expect(revoke).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(0); await pending;
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:raw-file'); expect(f.exists()).toBe(false);
  expect(f.remove).toHaveBeenCalledOnce();
});

it('releases the operation on an anchor failure and still revokes its URL', async () => {
  const f = recordingSinkFixture(); await f.sink.append(new Blob(['raw'])); const media = await f.sink.seal('video/mp4');
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:raw-file');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw new Error('anchor failed'); });
  await expect(downloadRecordingMedia({ blob: media.blob, resource: media.resource, status: 'READY', kind: 'VIDEO', mimeType: 'video/mp4', durationMs: 0,
    timebase: { activeSegments: [], nominalMediaDurationMs: 0 } }, 'capture.mp4')).rejects.toThrow('anchor failed');
  expect(f.exists()).toBe(true); expect(revoke).toHaveBeenCalledOnce();
  await media.resource.release(); expect(f.exists()).toBe(false);
});
