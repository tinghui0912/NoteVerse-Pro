import { openPerformanceTakeMedia } from "@/lib/api/performance-takes";
import {
  openOpfsMediaFile,
  type OpfsMediaStoragePlatform,
} from "../opfs-media-file";
import {
  releaseLocalMediaAsset,
  type LocalMediaAsset,
} from "../local-media-asset";

class PerformanceTakeMediaError extends Error {
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
    this.name = "PerformanceTakeMediaError";
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
export async function materializePerformanceTakeMedia(
  options: DownloadOptions,
  platform?: OpfsMediaStoragePlatform,
): Promise<LocalMediaAsset> {
  const { signal, expectedByteSize, expectedMimeType } = options;
  signal.throwIfAborted();
  if (!Number.isSafeInteger(expectedByteSize) || expectedByteSize <= 0)
    throw new PerformanceTakeMediaError("media_size_mismatch");
  const response = await openPerformanceTakeMedia(options.takeId, signal);
  const reader = response.body?.getReader();
  if (!reader) throw new PerformanceTakeMediaError("stream_unavailable");
  let file: Awaited<ReturnType<typeof openOpfsMediaFile>> | undefined;
  let media: LocalMediaAsset | undefined;
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
      throw new PerformanceTakeMediaError("media_size_mismatch");
    if (
      !mimeEssence(expectedMimeType) ||
      mimeEssence(response.headers.get("content-type") ?? "") !==
        mimeEssence(expectedMimeType)
    )
      throw new PerformanceTakeMediaError("media_type_mismatch");
    try {
      file = await openOpfsMediaFile(
        "noteverse-performance-take-media",
        signal,
        platform,
      );
    } catch (cause) {
      if (signal.aborted) throw signal.reason;
      throw new PerformanceTakeMediaError("storage_unavailable", { cause });
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
        throw new PerformanceTakeMediaError("media_size_mismatch");
      await file.append(value);
      written += value.byteLength;
      options.onProgress?.(written, expectedByteSize);
    }
    if (written !== expectedByteSize)
      throw new PerformanceTakeMediaError("media_size_mismatch");
    media = await file.seal(expectedMimeType);
    signal.throwIfAborted();
    completed = true;
    return media;
  } catch (cause) {
    if (signal.aborted) throw signal.reason;
    if (cause instanceof PerformanceTakeMediaError) throw cause;
    throw new PerformanceTakeMediaError("download_failed", { cause });
  } finally {
    signal.removeEventListener("abort", abort);
    try {
      if (!completed) {
        await reader.cancel().catch(() => {});
        if (media) await releaseLocalMediaAsset(media);
        else await file?.abort();
      }
      await aborting;
    } catch (cause) {
      if (signal.aborted) throw signal.reason;
      throw new PerformanceTakeMediaError("download_failed", { cause });
    } finally {
      reader.releaseLock();
    }
  }
}
