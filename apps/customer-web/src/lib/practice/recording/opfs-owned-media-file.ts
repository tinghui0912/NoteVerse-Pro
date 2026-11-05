import { reportUnexpectedClientError } from "@/lib/observability";
import { createOwnedMedia, type OwnedMediaHandle } from "./owned-media";

class OpfsMediaUnavailableError extends Error {}
export interface OpfsOwnedMediaFile {
  readonly byteSize: number;
  append(chunk: Blob | Uint8Array<ArrayBuffer>): Promise<void>;
  seal(mimeType: string): Promise<OwnedMediaHandle>;
  abort(): Promise<void>;
}

interface OwnedMediaFile {
  createWritable(): Promise<
    Pick<FileSystemWritableFileStream, "write" | "close" | "abort">
  >;
  getFile(): Promise<File>;
}
interface OwnedMediaDirectory {
  getDirectoryHandle(
    name: string,
    options: { create: boolean },
  ): Promise<OwnedMediaDirectory>;
  getFileHandle(
    name: string,
    options: { create: boolean },
  ): Promise<OwnedMediaFile>;
  removeEntry(name: string): Promise<void>;
  values(): AsyncIterable<{ name: string; kind: string }>;
}
export interface OpfsMediaStoragePlatform {
  root(): Promise<OwnedMediaDirectory>;
  locks: Pick<LockManager, "request">;
  randomId(): string;
}

function browserStorage(): OpfsMediaStoragePlatform {
  if (
    typeof navigator === "undefined" ||
    !navigator.storage?.getDirectory ||
    !navigator.locks?.request
  ) {
    throw new OpfsMediaUnavailableError("OPFS media storage unavailable");
  }
  return {
    root: async () =>
      (await navigator.storage.getDirectory()) as unknown as OwnedMediaDirectory,
    locks: navigator.locks,
    randomId: () => crypto.randomUUID(),
  };
}

async function holdLock(
  platform: OpfsMediaStoragePlatform,
  name: string,
  signal?: AbortSignal,
) {
  let release!: () => void;
  const retired = new Promise<void>((resolve) => {
    release = resolve;
  });
  let acquired!: () => void;
  let failed!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    acquired = resolve;
    failed = reject;
  });
  const held = platform.locks.request(name, { signal }, async () => {
    acquired();
    await retired;
  });
  held.catch(failed);
  await ready;
  return async () => {
    release();
    await held;
  };
}

async function reclaimOrphans(
  directory: OwnedMediaDirectory,
  platform: OpfsMediaStoragePlatform,
  namespace: string,
  signal?: AbortSignal,
) {
  for await (const entry of directory.values()) {
    signal?.throwIfAborted();
    if (entry.kind !== "file") continue;
    // Chromium writable sidecars share their backing file's lifetime, including across tabs.
    const ownerName = entry.name.replace(/\.crswap$/, "");
    await platform.locks.request(
      `${namespace}:${ownerName}`,
      { ifAvailable: true },
      async (lock) => {
        signal?.throwIfAborted();
        if (!lock) return;
        try {
          await directory.removeEntry(entry.name);
        } catch (error) {
          if (error instanceof DOMException && error.name === "NotFoundError")
            return;
          reportUnexpectedClientError(error, {
            area: "practice",
            operation: "media_orphan_recovery",
          });
        }
      },
    );
  }
}

/** The lock starts before file creation and spans recording, Review and operation leases. */
export async function openOpfsOwnedMediaFile(
  namespace: string,
  signal?: AbortSignal,
  platform?: OpfsMediaStoragePlatform,
  lockPrefix = namespace,
): Promise<OpfsOwnedMediaFile> {
  signal?.throwIfAborted();
  platform ??= browserStorage();
  let directory: OwnedMediaDirectory;
  try {
    directory = await (
      await platform.root()
    ).getDirectoryHandle(namespace, { create: true });
    await reclaimOrphans(directory, platform, lockPrefix, signal);
  } catch (cause) {
    if (signal?.aborted) throw signal.reason;
    throw new OpfsMediaUnavailableError("OPFS media storage unavailable", {
      cause,
    });
  }
  const id = platform.randomId();
  let unlock: () => Promise<void>;
  try {
    unlock = await holdLock(platform, `${lockPrefix}:${id}`, signal);
  } catch (cause) {
    if (signal?.aborted) throw signal.reason;
    throw new OpfsMediaUnavailableError("OPFS media storage unavailable", {
      cause,
    });
  }
  let writable:
    | Awaited<ReturnType<OwnedMediaFile["createWritable"]>>
    | undefined;
  let file: OwnedMediaFile;
  try {
    signal?.throwIfAborted();
    file = await directory.getFileHandle(id, { create: true });
    writable = await file.createWritable();
    signal?.throwIfAborted();
  } catch (cause) {
    try {
      await writable?.abort();
    } catch (error) {
      reportUnexpectedClientError(error);
    }
    try {
      await directory.removeEntry(id);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "NotFoundError"))
        reportUnexpectedClientError(error);
    }
    await unlock();
    if (signal?.aborted) throw signal.reason;
    throw new OpfsMediaUnavailableError("OPFS media storage unavailable", {
      cause,
    });
  }
  const writer = writable;
  let closed = false;
  let bytes = 0;
  let state: "OPEN" | "SEALING" | "SEALED" | "ABORTED" = "OPEN";
  let queue: Promise<void> = Promise.resolve();
  let aborting: Promise<void> | null = null;
  let sealed: Promise<OwnedMediaHandle> | null = null;
  const wasAbandoned = () => state === "ABORTED";
  const remove = async () => {
    try {
      await directory.removeEntry(id);
    } finally {
      await unlock();
    }
  };
  return {
    get byteSize() {
      return bytes;
    },
    append(chunk) {
      if (state !== "OPEN")
        return Promise.reject(new Error("Media file is closed."));
      bytes += chunk instanceof Blob ? chunk.size : chunk.byteLength;
      queue = queue.then(() => writer.write(chunk));
      return queue;
    },
    seal(mimeType) {
      if (sealed) return sealed;
      if (state !== "OPEN")
        return Promise.reject(new Error("Media file is closed."));
      state = "SEALING";
      sealed = (async () => {
        await queue;
        await writer.close();
        closed = true;
        const raw = await file.getFile();
        if (wasAbandoned()) throw new Error("Media file was abandoned.");
        if (raw.size !== bytes)
          throw new Error("Media file byte size mismatch.");
        // Blob slicing changes metadata without reading the file bytes into JS heap.
        const blob = raw.slice(0, raw.size, mimeType);
        state = "SEALED";
        return createOwnedMedia(blob, remove);
      })();
      return sealed;
    },
    abort() {
      if (state === "SEALED") return Promise.resolve();
      if (!aborting) {
        const sealing = state === "SEALING";
        state = "ABORTED";
        aborting = (async () => {
          const stopping = sealing
            ? null
            : Promise.resolve().then(() => writer.abort());
          const [stopped] = await Promise.allSettled([
            stopping ?? Promise.resolve(),
            queue,
          ]);
          if (sealed) await sealed.catch(() => {});
          try {
            if (sealing && !closed) await writer.abort();
            if (stopped.status === "rejected") throw stopped.reason;
          } finally {
            await remove();
          }
        })();
      }
      return aborting;
    },
  };
}
