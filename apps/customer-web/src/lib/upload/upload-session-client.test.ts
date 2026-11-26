import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadSession, UploadSessionError } from './upload-session-client';
import type { uploadSessionApi } from './upload-session-api';
import { uploadSessionFixture } from '../../../tests/helpers/upload-session';
function fixture(overrides: Parameters<typeof uploadSessionFixture>[0] = {}) {
  const session = uploadSessionFixture(overrides);
  const api = {
    read: vi.fn().mockResolvedValue(session),
    parts: vi.fn().mockResolvedValue([]),
    partTarget: vi
      .fn()
      .mockImplementation(async (_id, part) => ({
        ...session.upload_target,
        url: `https://objects.test/part/${part}`,
      })),
    complete: vi.fn().mockResolvedValue({ ...session, status: 'COMPLETED' }),
  } satisfies typeof uploadSessionApi;
  const put = vi.fn(
    async (
      _target: unknown,
      body: Blob,
      _signal: AbortSignal,
      progress: (n: number) => void,
    ) => {
      progress(body.size);
    },
  );
  return { session, api, put };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('transfers a Single PUT Blob with progress and confirms completion', async () => {
  const f = fixture(),
    progress = vi.fn(),
    body = new Blob(['123456789012'], { type: 'audio/wav' });
  expect(
    (await uploadSession('session-1', body, { ...f, onProgress: progress }))
      .status,
  ).toBe('COMPLETED');
  expect(f.put).toHaveBeenCalledWith(
    f.session.upload_target,
    body,
    expect.any(AbortSignal),
    expect.any(Function),
  );
  expect(progress).toHaveBeenLastCalledWith({
    uploadedBytes: 12,
    totalBytes: 12,
  });
  expect(f.api.complete).toHaveBeenCalledOnce();
});
it.each(['COMPLETED', 'CONSUMED'] as const)(
  'resumes %s without writing',
  async (status) => {
    const f = fixture({ status });
    await uploadSession('id', new Blob(['123456789012']), f);
    expect(f.put).not.toHaveBeenCalled();
    expect(f.api.complete).not.toHaveBeenCalled();
  },
);
it.each([{ expected_byte_size: 11 }, { expected_content_type: 'video/mp4' }])(
  'rejects local declaration mismatch before transfer %j',
  async (mismatch) => {
    const f = fixture(mismatch);
    await expect(
      uploadSession('id', new Blob(['123456789012'], { type: 'audio/wav' }), f),
    ).rejects.toBeInstanceOf(UploadSessionError);
    expect(f.put).not.toHaveBeenCalled();
  },
);
it('slices exact Multipart parts and bounds concurrent requests', async () => {
  const f = fixture({
    mode: 'MULTIPART',
    expected_byte_size: 17,
    part_size: 4,
    part_count: 5,
  });
  let active = 0,
    max = 0;
  const release: Array<() => void> = [];
  const put = vi.fn(async (_target: unknown, body: Blob) => {
    active++;
    max = Math.max(active, max);
    await new Promise<void>((resolve) => release.push(resolve));
    active--;
    expect(body.size).toBeLessThanOrEqual(4);
  });
  const pending = uploadSession('id', new Blob(['12345678901234567']), {
    api: f.api,
    put,
  });
  await vi.waitFor(() => expect(release).toHaveLength(3));
  expect(max).toBe(3);
  release.splice(0).forEach((resolve) => resolve());
  await vi.waitFor(() => expect(release).toHaveLength(2));
  release.splice(0).forEach((resolve) => resolve());
  await pending;
  expect(put.mock.calls.map(([, blob]) => blob.size)).toEqual([4, 4, 4, 4, 1]);
  expect(f.api.complete).toHaveBeenCalledOnce();
});
it('resumes only missing server-verified parts', async () => {
  const f = fixture({ mode: 'MULTIPART', part_size: 5, part_count: 3 });
  f.api.parts.mockResolvedValue([
    { part_number: 2, byte_size: 5, etag: 'etag' },
  ]);
  await uploadSession('id', new Blob(['123456789012']), f);
  expect(f.api.partTarget.mock.calls.map((call) => call[1])).toEqual([1, 3]);
  expect(f.put.mock.calls.map((call) => call[1].size)).toEqual([5, 2]);
});
it.each([
  { part_number: 1, byte_size: 4, etag: 'e' },
  { part_number: 9, byte_size: 5, etag: 'e' },
  { part_number: 1, byte_size: 5, etag: '' },
])('refuses invalid server part evidence %j', async (part) => {
  const f = fixture({ mode: 'MULTIPART', part_size: 5, part_count: 3 });
  f.api.parts.mockResolvedValue([part]);
  await expect(
    uploadSession('id', new Blob(['123456789012']), f),
  ).rejects.toMatchObject({ reason: 'size_mismatch' });
  expect(f.api.complete).not.toHaveBeenCalled();
});
it.each([0, 403, 500])(
  'renews a failed part target for retry at status %s',
  async (status) => {
    const f = fixture({ mode: 'MULTIPART', part_size: 12, part_count: 1 });
    f.put.mockRejectedValueOnce(
      new UploadSessionError(status ? 'provider_rejected' : 'network', status),
    );
    await uploadSession('id', new Blob(['123456789012']), f);
    expect(f.api.partTarget).toHaveBeenCalledTimes(2);
    expect(f.api.complete).toHaveBeenCalledOnce();
  },
);
it('bounds retries and retains the session after persistent network failure', async () => {
  const f = fixture({ mode: 'MULTIPART', part_size: 12, part_count: 1 }),
    cancel = vi.fn();
  f.put.mockRejectedValue(new UploadSessionError('network'));
  await expect(
    uploadSession('id', new Blob(['123456789012']), { ...f, cancel }),
  ).rejects.toMatchObject({ reason: 'network' });
  expect(f.put).toHaveBeenCalledTimes(3);
  expect(cancel).not.toHaveBeenCalled();
  expect(f.api.complete).not.toHaveBeenCalled();
});
it('cancels active transport and requests domain cancellation', async () => {
  const f = fixture(),
    abort = new AbortController(),
    cancel = vi.fn();
  const put = vi.fn(
    async (_target: unknown, _blob: Blob, signal: AbortSignal) =>
      new Promise<void>((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        }),
      ),
  );
  const pending = uploadSession('id', new Blob(['123456789012']), {
    api: f.api,
    put,
    signal: abort.signal,
    cancel,
  });
  const rejected = expect(pending).rejects.toMatchObject({
    name: 'AbortError',
  });
  await vi.waitFor(() => expect(put).toHaveBeenCalledOnce());
  abort.abort();
  await rejected;
  expect(cancel).toHaveBeenCalledOnce();
  expect(f.api.complete).not.toHaveBeenCalled();
});
describe('credential-free signed browser transport', () => {
  it('lets the browser set exact Content-Length and reports real progress', async () => {
    const calls: Record<string, string> = {},
      open = vi.fn(),
      send = vi.fn();
    let body: Blob | undefined;
    class Xhr {
      status = 200;
      withCredentials = true;
      timeout = 0;
      upload: {
        onprogress:
          | ((e: { lengthComputable: boolean; loaded: number }) => void)
          | null;
      } = { onprogress: null };
      onload: (() => void) | null = null;
      onerror = null;
      onabort = null;
      ontimeout = null;
      open = open;
      setRequestHeader = (name: string, value: string) => {
        calls[name] = value;
      };
      abort = vi.fn();
      send = (value: Blob) => {
        body = value;
        send();
        expect(this.withCredentials).toBe(false);
        this.upload.onprogress?.({
          lengthComputable: true,
          loaded: value.size,
        });
        this.onload?.();
      };
    }
    vi.stubGlobal('XMLHttpRequest', Xhr);
    const f = fixture();
    await uploadSession('id', new Blob(['123456789012']), { api: f.api });
    expect(calls).toEqual({ 'content-type': 'audio/wav' });
    expect(body?.size).toBe(12);
    expect(send).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith('PUT', f.session.upload_target?.url);
  });
  it('rejects malformed signed targets without network activity', async () => {
    const f = fixture({
      upload_target: {
        url: '/relative',
        method: 'PUT',
        headers: {},
        expires_in: 900,
      },
    });
    await expect(
      uploadSession('id', new Blob(['123456789012']), { api: f.api }),
    ).rejects.toMatchObject({ reason: 'invalid_target' });
  });
});
it('renews an expired Single PUT capability once', async () => {
  const f = fixture();
  f.put.mockRejectedValueOnce(new UploadSessionError('provider_rejected', 403));
  await uploadSession('id', new Blob(['123456789012']), f);
  expect(f.api.read).toHaveBeenCalledTimes(2);
  expect(f.put).toHaveBeenCalledTimes(2);
});
it('recovers a lost completion response through committed server facts', async () => {
  const f = fixture();
  f.api.complete.mockRejectedValue(new TypeError('response lost'));
  f.api.read
    .mockResolvedValueOnce(f.session)
    .mockResolvedValueOnce({ ...f.session, status: 'COMPLETED' });
  expect(
    (await uploadSession('id', new Blob(['123456789012']), f)).status,
  ).toBe('COMPLETED');
  expect(f.put).toHaveBeenCalledOnce();
  expect(f.api.complete).toHaveBeenCalledOnce();
});
it('retains an unknown completion for server recovery without another physical write', async () => {
  const f = fixture(),
    error = new TypeError('response lost');
  f.api.complete.mockRejectedValue(error);
  f.api.read
    .mockResolvedValueOnce(f.session)
    .mockResolvedValueOnce({ ...f.session, status: 'COMPLETING' });
  await expect(uploadSession('id', new Blob(['123456789012']), f)).rejects.toBe(
    error,
  );
  expect(f.put).toHaveBeenCalledOnce();
  expect(f.api.complete).toHaveBeenCalledOnce();
});

it('retains the abort result even when domain cancellation is unavailable', async () => {
  const f = fixture(),
    abort = new AbortController();
  abort.abort();
  const cancel = vi.fn().mockRejectedValue(new Error('offline'));
  await expect(
    uploadSession('id', new Blob(['123456789012']), {
      ...f,
      signal: abort.signal,
      cancel,
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(f.put).not.toHaveBeenCalled();
  expect(cancel).toHaveBeenCalledOnce();
});
