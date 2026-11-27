import type { UploadSessionRead, UploadTargetRead } from '@/generated/api';
import { uploadSessionApi } from './upload-session-api';

type UploadFailure =
  | 'size_mismatch'
  | 'type_mismatch'
  | 'session_unavailable'
  | 'invalid_target'
  | 'network'
  | 'provider_rejected';
export class UploadSessionError extends Error {
  readonly code = 'file_error';
  constructor(
    readonly reason: UploadFailure,
    readonly status = 0,
  ) {
    super(reason);
    this.name = 'UploadSessionError';
  }
}
type UploadProgress = Readonly<{ uploadedBytes: number; totalBytes: number }>;
type Put = (
  target: UploadTargetRead,
  body: Blob,
  signal: AbortSignal,
  progress: (bytes: number) => void,
) => Promise<void>;
export type UploadSessionOptions = Readonly<{
  signal?: AbortSignal;
  onProgress?(progress: UploadProgress): void;
  cancel?(): Promise<void>;
  api?: typeof uploadSessionApi;
  put?: Put;
}>;

/** Signed capabilities use a credential-free transport with browser-owned body length. */
function putBlob(
  target: UploadTargetRead,
  body: Blob,
  signal: AbortSignal,
  progress: (bytes: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    let url: URL;
    try {
      url = new URL(target.url);
    } catch {
      throw new UploadSessionError('invalid_target');
    }
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      target.method !== 'PUT' ||
      url.username ||
      url.password
    )
      throw new UploadSessionError('invalid_target');
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const finish = (error?: unknown) => {
      signal.removeEventListener('abort', abort);
      xhr.onload = xhr.onerror = xhr.onabort = xhr.ontimeout = null;
      xhr.upload.onprogress = null;
      if (error) reject(error);
      else resolve();
    };
    xhr.open('PUT', target.url);
    xhr.withCredentials = false;
    xhr.timeout = Math.max(1, target.expires_in) * 1000;
    for (const [name, value] of Object.entries(target.headers)) {
      if (name.toLowerCase() === 'content-length') {
        if (Number(value) !== body.size)
          throw new UploadSessionError('size_mismatch');
      } else xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) progress(event.loaded);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? finish()
        : finish(new UploadSessionError('provider_rejected', xhr.status));
    xhr.onerror = xhr.ontimeout = () =>
      finish(new UploadSessionError('network'));
    xhr.onabort = () =>
      finish(
        signal.reason ?? new DOMException('Upload cancelled', 'AbortError'),
      );
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      finish(signal.reason);
      return;
    }
    xhr.send(body);
  });
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** The server owns the immutable plan and business consumption; this client owns transfer. */
export async function uploadSession(
  sessionId: string,
  body: Blob,
  options: UploadSessionOptions = {},
): Promise<UploadSessionRead> {
  const api = options.api ?? uploadSessionApi;
  const put = options.put ?? putBlob;
  const controller = new AbortController();
  const cancel = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const { signal } = controller;
  try {
    signal.throwIfAborted();
    const session = await api.read(sessionId, signal);
    if (body.size !== session.expected_byte_size)
      throw new UploadSessionError('size_mismatch');
    if (
      body.type &&
      body.type.split(';')[0].toLowerCase() !==
        session.expected_content_type.split(';')[0].toLowerCase()
    )
      throw new UploadSessionError('type_mismatch');
    if (session.status === 'COMPLETED' || session.status === 'CONSUMED') {
      options.onProgress?.({ uploadedBytes: body.size, totalBytes: body.size });
      return session;
    }
    if (session.status !== 'UPLOADING')
      throw new UploadSessionError('session_unavailable');
    const progress = new Map<number, number>();
    let reported = 0;
    const update = (part: number, size: number) => {
      progress.set(part, size);
      reported = Math.max(
        reported,
        [...progress.values()].reduce((sum, bytes) => sum + bytes, 0),
      );
      options.onProgress?.({
        uploadedBytes: Math.min(body.size, reported),
        totalBytes: body.size,
      });
    };
    if (session.mode === 'SINGLE_PUT') {
      let target = session.upload_target;
      if (!target) throw new UploadSessionError('session_unavailable');
      try {
        await put(target, body, signal, (bytes) => update(1, bytes));
      } catch (error) {
        if (
          !(error instanceof UploadSessionError) ||
          error.status !== 403 ||
          signal.aborted
        )
          throw error;
        target = (await api.read(sessionId, signal)).upload_target;
        if (!target) throw new UploadSessionError('session_unavailable');
        await put(target, body, signal, (bytes) => update(1, bytes));
      }
      update(1, body.size);
    } else {
      const size = session.part_size;
      if (
        !Number.isSafeInteger(size) ||
        size <= 0 ||
        session.part_count !== Math.ceil(body.size / size) ||
        session.part_count > 10000
      )
        throw new UploadSessionError('session_unavailable');
      const uploaded = await api.parts(sessionId, signal);
      const completed = new Set<number>();
      for (const part of uploaded) {
        const expected = Math.min(
          size,
          body.size - (part.part_number - 1) * size,
        );
        if (
          part.part_number < 1 ||
          part.part_number > session.part_count ||
          completed.has(part.part_number) ||
          !part.etag ||
          part.byte_size !== expected
        )
          throw new UploadSessionError('size_mismatch');
        completed.add(part.part_number);
        update(part.part_number, expected);
      }
      const pending = Array.from(
        { length: session.part_count },
        (_, index) => index + 1,
      ).filter((part) => !completed.has(part));
      let next = 0;
      const worker = async () => {
        while (next < pending.length) {
          signal.throwIfAborted();
          const number = pending[next++];
          const chunk = body.slice(
            (number - 1) * size,
            Math.min(number * size, body.size),
            session.expected_content_type,
          );
          for (let attempt = 0; ; attempt++) {
            signal.throwIfAborted();
            try {
              const target = await api.partTarget(sessionId, number, signal);
              await put(target, chunk, signal, (bytes) =>
                update(number, bytes),
              );
              update(number, chunk.size);
              break;
            } catch (error) {
              const retryable =
                error instanceof UploadSessionError &&
                (error.reason === 'network' ||
                  [403, 408, 429].includes(error.status) ||
                  error.status >= 500);
              if (signal.aborted || !retryable || attempt >= 2) throw error;
              update(number, 0);
              await pause(250 * 2 ** attempt, signal);
            }
          }
        }
      };
      const concurrency = Number.isSafeInteger(session.recommended_concurrency)
        ? Math.max(1, Math.min(3, session.recommended_concurrency))
        : 3;
      const workers = Array.from(
        { length: Math.min(concurrency, pending.length) },
        () =>
          worker().catch((error) => {
            controller.abort(error);
            throw error;
          }),
      );
      const outcomes = await Promise.allSettled(workers);
      const failed = outcomes.find((result) => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    }
    signal.throwIfAborted();
    let result: UploadSessionRead;
    try {
      result = await api.complete(sessionId, signal);
    } catch (error) {
      signal.throwIfAborted();
      // A fresh persisted read recovers a lost completion response without replaying IO.
      try {
        const persisted = await api.read(sessionId, signal);
        if (persisted.status === 'COMPLETED' || persisted.status === 'CONSUMED')
          return persisted;
      } catch {
        signal.throwIfAborted();
      }
      throw error;
    }
    if (!['COMPLETED', 'CONSUMED'].includes(result.status))
      throw new UploadSessionError('session_unavailable');
    return result;
  } finally {
    options.signal?.removeEventListener('abort', cancel);
    if (options.signal?.aborted) {
      try {
        await options.cancel?.();
      } catch {
        /* Durable session expiration retains cleanup responsibility. */
      }
    }
  }
}
