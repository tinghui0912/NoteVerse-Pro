import { afterEach, expect, it, vi } from 'vitest';
import { releaseOwnedMedia } from './owned-media';
import { openOpfsRecordingSink } from './opfs-recording-sink';
import { opfsStoreFixture } from '../__fixtures__/opfs-store';
import { reportUnexpectedClientError } from '@/lib/observability';

vi.mock('@/lib/observability', () => ({ reportUnexpectedClientError: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('creates unique names in its dedicated namespace and writes Blobs incrementally in order', async () => {
  const f = opfsStoreFixture();
  const sink = await openOpfsRecordingSink(undefined, f.platform);
  expect(f.directory.getDirectoryHandle).toHaveBeenCalledExactlyOnceWith('noteverse-practice-captures', { create: true });
  let complete!: () => void;
  f.write.mockImplementationOnce(async (id, chunk) => {
    await new Promise<void>(resolve => { complete = resolve; }); f.files.get(id)!.push(chunk);
  });
  const first = new Blob(['first']), second = new Blob(['second']);
  const a = sink.append(first), b = sink.append(second);
  await Promise.resolve(); expect(f.write).toHaveBeenCalledOnce();
  let sealed = false;
  const final = sink.seal('video/mp4').then(media => { sealed = true; return media; });
  await Promise.resolve(); expect(sealed).toBe(false); expect(f.close).not.toHaveBeenCalled();
  complete(); await a; await b; const media = await final;
  expect(f.write.mock.calls.map(([, chunk]) => chunk)).toEqual([first, second]);
  expect(await media.blob.text()).toBe('firstsecond');
  expect(media.blob.type).toBe('video/mp4');
  expect(sink.byteSize).toBe(11); expect(media.byteSize).toBe(media.blob.size);
  expect(f.close).toHaveBeenCalledOnce(); expect(f.files.size).toBe(1);
  const lease = media.retain();
  await media.release(); await media.release();
  expect(f.files.size).toBe(1); expect(await media.blob.text()).toBe('firstsecond');
  await lease.release(); await lease.release(); expect(f.files.size).toBe(0); expect(f.remove).toHaveBeenCalledOnce();
  expect(() => lease.retain()).toThrow('retired');
});

it('aborts untransferred storage exactly once, including a failed write', async () => {
  const f = opfsStoreFixture(), sink = await openOpfsRecordingSink(undefined, f.platform);
  f.write.mockRejectedValueOnce(new Error('disk full'));
  await expect(sink.append(new Blob(['bytes']))).rejects.toThrow('disk full');
  await expect(sink.seal('audio/webm')).rejects.toThrow('disk full');
  await sink.abort(); await sink.abort();
  expect(f.abort).toHaveBeenCalledOnce(); expect(f.remove).toHaveBeenCalledOnce(); expect(f.held.size).toBe(0);
});

it('propagates unsealed cleanup failure and leaves the orphan unlocked for recovery', async () => {
  const f = opfsStoreFixture(), sink = await openOpfsRecordingSink(undefined, f.platform);
  f.remove.mockRejectedValueOnce(new Error('remove denied'));
  await expect(sink.abort()).rejects.toThrow('remove denied');
  expect(f.files.size).toBe(1); expect(f.held.size).toBe(0);
  const next = await openOpfsRecordingSink(undefined, f.platform);
  expect([...f.files.keys()]).toEqual(['capture-2']); await next.abort();
});

it('reports sealed-media deletion failure without rejecting completed ownership retirement', async () => {
  const f = opfsStoreFixture(), sink = await openOpfsRecordingSink(undefined, f.platform);
  await sink.append(new Blob(['raw'])); const media = await sink.seal('audio/webm');
  f.remove.mockRejectedValueOnce(new Error('delete denied'));
  await expect(releaseOwnedMedia(media)).resolves.toBeUndefined();
  expect(reportUnexpectedClientError).toHaveBeenCalled(); expect(f.files.size).toBe(1); expect(f.held.size).toBe(0);
  const next = await openOpfsRecordingSink(undefined, f.platform); await next.abort(); expect(f.files.size).toBe(0);
});

it('reclaims a crashed owner while preserving another context holding a live media lock', async () => {
  const f = opfsStoreFixture(), live = await openOpfsRecordingSink(undefined, f.platform);
  await live.append(new Blob(['live'])); const media = await live.seal('audio/webm');
  f.files.set('crashed-owner', [new Blob(['orphan'])]);
  const next = await openOpfsRecordingSink(undefined, f.platform);
  expect(f.files.has('crashed-owner')).toBe(false); expect(f.files.has('capture-1')).toBe(true);
  expect(f.files.has('capture-2')).toBe(true); await next.abort(); await media.release();
  expect(f.files.size).toBe(0); expect(f.held.size).toBe(0);
});

it('closes and removes a sink whose seal cannot close successfully', async () => {
  const f = opfsStoreFixture(), sink = await openOpfsRecordingSink(undefined, f.platform);
  await sink.append(new Blob(['raw'])); f.close.mockRejectedValueOnce(new Error('close failed'));
  await expect(sink.seal('audio/webm')).rejects.toThrow('close failed');
  await sink.abort(); expect(f.abort).toHaveBeenCalledOnce(); expect(f.files.size).toBe(0);
});

it('requires both OPFS and cross-context locks, without a substitute storage path', async () => {
  vi.stubGlobal('navigator', { storage: {} });
  await expect(openOpfsRecordingSink()).rejects.toThrow('RECORDING_STORAGE_UNAVAILABLE');
  const f = opfsStoreFixture(); vi.stubGlobal('navigator', { storage: { getDirectory: f.platform.root } });
  await expect(openOpfsRecordingSink()).rejects.toThrow('RECORDING_STORAGE_UNAVAILABLE');
  expect(f.files.size).toBe(0);
});

it('signals writable abort before waiting for a pending append to settle', async () => {
  const f = opfsStoreFixture(), sink = await openOpfsRecordingSink(undefined, f.platform);
  let fail!: (error: Error) => void;
  f.write.mockImplementationOnce(() => new Promise<void>((_, reject) => { fail = reject; }));
  f.abort.mockImplementationOnce(async () => { fail(new DOMException('aborted', 'AbortError')); });
  const writing = sink.append(new Blob(['pending'])); const rejected = expect(writing).rejects.toThrow('aborted');
  await Promise.resolve(); const retiring = sink.abort(); await rejected; await retiring;
  expect(f.abort).toHaveBeenCalledOnce(); expect(f.files.size).toBe(0); expect(f.held.size).toBe(0);
});

it('retires an aborted seal without publishing an orphaned media reference', async () => {
  const f = opfsStoreFixture(), sink = await openOpfsRecordingSink(undefined, f.platform);
  await sink.append(new Blob(['raw'])); let close!: () => void;
  f.close.mockImplementationOnce(() => new Promise<void>(resolve => { close = resolve; }));
  const sealing = sink.seal('audio/webm'); const rejected = expect(sealing).rejects.toThrow('abandoned');
  await Promise.resolve(); await Promise.resolve(); const retiring = sink.abort(); close();
  await rejected; await retiring; expect(f.files.size).toBe(0); expect(f.remove).toHaveBeenCalledOnce();
});
