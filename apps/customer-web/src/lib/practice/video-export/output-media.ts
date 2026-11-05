import {
  openOpfsOwnedMediaFile,
  type OpfsMediaStoragePlatform,
  type OpfsOwnedMediaFile,
} from "@/lib/practice/recording/opfs-owned-media-file";

/** Temporary browser-generated derivatives have their own byte-storage lifetime. */
export async function openVideoExportOutputMedia(
  signal?: AbortSignal,
  platform?: OpfsMediaStoragePlatform,
): Promise<OpfsOwnedMediaFile> {
  try {
    return await openOpfsOwnedMediaFile(
      "noteverse-video-export-output",
      signal,
      platform,
    );
  } catch (cause) {
    if (signal?.aborted)
      throw new DOMException("Export cancelled", "AbortError");
    throw new Error("video_export_unavailable:output_storage", { cause });
  }
}
