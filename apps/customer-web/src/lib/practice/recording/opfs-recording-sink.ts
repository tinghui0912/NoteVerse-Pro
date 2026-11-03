import { RecordingFailure } from '@/lib/practice/failure/causal-failure';
import { reportUnexpectedClientError } from '@/lib/observability';
import { createRecordingMediaResource } from './recording-media-resource';
import type { RecordingSink, SealedRecordingMedia } from './recording-sink';

const CAPTURE_NAMESPACE = 'noteverse-practice-captures';
const lockName = (id: string) => `noteverse-practice-capture:${id}`;

interface CaptureFile {
  createWritable(): Promise<Pick<FileSystemWritableFileStream, 'write' | 'close' | 'abort'>>;
  getFile(): Promise<File>;
}
interface CaptureDirectory {
  getDirectoryHandle(name: string, options: { create: boolean }): Promise<CaptureDirectory>;
  getFileHandle(name: string, options: { create: boolean }): Promise<CaptureFile>;
  removeEntry(name: string): Promise<void>;
  values(): AsyncIterable<{ name: string; kind: string }>;
}
export interface RecordingStoragePlatform {
  root(): Promise<CaptureDirectory>;
  locks: Pick<LockManager, 'request'>;
  randomId(): string;
}

function browserStorage(): RecordingStoragePlatform {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory || !navigator.locks?.request) {
    throw new RecordingFailure('RECORDING_STORAGE_UNAVAILABLE');
  }
  return {
    root: async () => await navigator.storage.getDirectory() as unknown as CaptureDirectory,
    locks: navigator.locks,
    randomId: () => crypto.randomUUID(),
  };
}

async function holdLock(platform: RecordingStoragePlatform, id: string, signal?: AbortSignal) {
  let release!: () => void;
  const retired = new Promise<void>(resolve => { release = resolve; });
  let acquired!: () => void;
  let failed!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => { acquired = resolve; failed = reject; });
  const held = platform.locks.request(lockName(id), { signal }, async () => { acquired(); await retired; });
  held.catch(failed);
  await ready;
  return async () => { release(); await held; };
}

async function reclaimOrphans(directory: CaptureDirectory, platform: RecordingStoragePlatform, signal?: AbortSignal) {
  for await (const entry of directory.values()) {
    signal?.throwIfAborted();
    if (entry.kind !== 'file') continue;
    await platform.locks.request(lockName(entry.name), { ifAvailable: true }, async lock => {
      signal?.throwIfAborted();
      if (!lock) return;
      try { await directory.removeEntry(entry.name); }
      catch (error) {
        if (error instanceof DOMException && error.name === 'NotFoundError') return;
        reportUnexpectedClientError(error, { area: 'practice', operation: 'capture_orphan_recovery' });
      }
    });
  }
}

/** The lock starts before file creation and spans recording, Review and operation leases. */
export async function openOpfsRecordingSink(signal?: AbortSignal, platform?: RecordingStoragePlatform): Promise<RecordingSink> {
  signal?.throwIfAborted();
  platform ??= browserStorage();
  let directory: CaptureDirectory;
  try {
    directory = await (await platform.root()).getDirectoryHandle(CAPTURE_NAMESPACE, { create: true });
    await reclaimOrphans(directory, platform, signal);
  } catch (cause) {
    if (signal?.aborted) throw signal.reason;
    throw new RecordingFailure('RECORDING_STORAGE_UNAVAILABLE', { cause });
  }
  const id = platform.randomId();
  let unlock: () => Promise<void>;
  try { unlock = await holdLock(platform, id, signal); }
  catch (cause) {
    if (signal?.aborted) throw signal.reason;
    throw new RecordingFailure('RECORDING_STORAGE_UNAVAILABLE', { cause });
  }
  let writable: Awaited<ReturnType<CaptureFile['createWritable']>> | undefined;
  let file: CaptureFile;
  try {
    signal?.throwIfAborted();
    file = await directory.getFileHandle(id, { create: true });
    writable = await file.createWritable();
    signal?.throwIfAborted();
  } catch (cause) {
    try { await writable?.abort(); } catch (error) { reportUnexpectedClientError(error); }
    try { await directory.removeEntry(id); } catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) reportUnexpectedClientError(error);
    }
    await unlock();
    if (signal?.aborted) throw signal.reason;
    throw new RecordingFailure('RECORDING_STORAGE_UNAVAILABLE', { cause });
  }
  const writer = writable;
  let closed = false;
  let bytes = 0;
  let state: 'OPEN' | 'SEALING' | 'SEALED' | 'ABORTED' = 'OPEN';
  let queue: Promise<void> = Promise.resolve();
  let aborting: Promise<void> | null = null;
  let sealed: Promise<SealedRecordingMedia> | null = null;
  const wasAbandoned = () => state === 'ABORTED';
  const remove = async () => { try { await directory.removeEntry(id); } finally { await unlock(); } };
  return {
    get byteSize() { return bytes; },
    append(chunk) {
      if (state !== 'OPEN') return Promise.reject(new Error('Recording sink is closed.'));
      bytes += chunk.size;
      queue = queue.then(() => writer.write(chunk));
      return queue;
    },
    seal(mimeType) {
      if (sealed) return sealed;
      if (state !== 'OPEN') return Promise.reject(new Error('Recording sink is closed.'));
      state = 'SEALING';
      sealed = (async () => {
        await queue; await writer.close(); closed = true;
        const raw = await file.getFile();
        if (wasAbandoned()) throw new Error('Recording sink was abandoned.');
        if (raw.size !== bytes) throw new Error('Recording sink byte size mismatch.');
        // Blob slicing changes metadata without reading the file bytes into JS heap.
        const blob = raw.slice(0, raw.size, mimeType);
        state = 'SEALED';
        return Object.freeze({ blob, byteSize: bytes, resource: createRecordingMediaResource(remove) });
      })();
      return sealed;
    },
    abort() {
      if (state === 'SEALED') return Promise.resolve();
      if (!aborting) {
        const sealing = state === 'SEALING';
        state = 'ABORTED';
        aborting = (async () => {
          const stopping = sealing ? null : Promise.resolve().then(() => writer.abort());
          const [stopped] = await Promise.allSettled([stopping ?? Promise.resolve(), queue]);
          if (sealed) await sealed.catch(() => {});
          try {
            if (sealing && !closed) await writer.abort();
            if (stopped.status === 'rejected') throw stopped.reason;
          } finally { await remove(); }
        })();
      }
      return aborting;
    },
  };
}
