import { openPerformanceTakeMedia } from "@/lib/api/performance-takes";
import {
  openOpfsOwnedMediaFile,
  type OpfsMediaStoragePlatform,
} from "./opfs-owned-media-file";
import { releaseOwnedMedia, type OwnedMediaHandle } from "./owned-media";

class SavedTakeMediaError extends Error {
  constructor(
    readonly reason:
      | "storage_unavailable"
      | "stream_unavailable"
      | "media_size_mismatch"
      | "media_type_mismatch"
      | "download_failed",
    options?: ErrorOptions,
  ) {
    super(reason, options);
    this.name = "SavedTakeMediaError";
  }
}
type DownloadOptions = Readonly<{
  takeId: string;
  expectedByteSize: number;
  expectedMimeType: string;
  signal: AbortSignal;
  onProgress?(writtenBytes: number, totalBytes: number): void;
}>;
const mimeEssence = (value: string) => value.split(";")[0].trim().toLowerCase();

/** A disposable local realization of durable server bytes; no cache and no heap buffering. */
export async function downloadSavedTakeMedia(
  options: DownloadOptions,
  platform?: OpfsMediaStoragePlatform,
): Promise<OwnedMediaHandle> {
  const { signal, expectedByteSize, expectedMimeType } = options;
  signal.throwIfAborted();
  if (!Number.isSafeInteger(expectedByteSize) || expectedByteSize <= 0)
    throw new SavedTakeMediaError("media_size_mismatch");
  const response = await openPerformanceTakeMedia(options.takeId, signal);
  const reader = response.body?.getReader();
  if (!reader) throw new SavedTakeMediaError("stream_unavailable");
  let file: Awaited<ReturnType<typeof openOpfsOwnedMediaFile>> | undefined;
  let media: OwnedMediaHandle | undefined;
  let completed = false;
  let aborting: Promise<unknown> | undefined;
  const abort = () => {
    aborting = Promise.allSettled([
      reader.cancel(signal.reason),
      file?.abort(),
    ]);
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const length = response.headers.get("content-length");
    if (
      length !== null &&
      (!/^\d+$/.test(length) || Number(length) !== expectedByteSize)
    )
      throw new SavedTakeMediaError("media_size_mismatch");
    if (
      !mimeEssence(expectedMimeType) ||
      mimeEssence(response.headers.get("content-type") ?? "") !==
        mimeEssence(expectedMimeType)
    )
      throw new SavedTakeMediaError("media_type_mismatch");
    try {
      file = await openOpfsOwnedMediaFile(
        "noteverse-performance-take-media",
        signal,
        platform,
      );
    } catch (cause) {
      if (signal.aborted) throw signal.reason;
      throw new SavedTakeMediaError("storage_unavailable", { cause });
    }
    signal.throwIfAborted();
    let written = 0;
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      if (!value) continue;
      if (value.byteLength > expectedByteSize - written)
        throw new SavedTakeMediaError("media_size_mismatch");
      await file.append(value);
      written += value.byteLength;
      options.onProgress?.(written, expectedByteSize);
    }
    if (written !== expectedByteSize)
      throw new SavedTakeMediaError("media_size_mismatch");
    media = await file.seal(expectedMimeType);
    signal.throwIfAborted();
    completed = true;
    return media;
  } catch (cause) {
    if (signal.aborted) throw signal.reason;
    if (cause instanceof SavedTakeMediaError) throw cause;
    throw new SavedTakeMediaError("download_failed", { cause });
  } finally {
    signal.removeEventListener("abort", abort);
    try {
      if (!completed) {
        await reader.cancel().catch(() => {});
        if (media) await releaseOwnedMedia(media);
        else await file?.abort();
      }
      await aborting;
    } catch (cause) {
      if (signal.aborted) throw signal.reason;
      throw new SavedTakeMediaError("download_failed", { cause });
    } finally {
      reader.releaseLock();
    }
  }
}
