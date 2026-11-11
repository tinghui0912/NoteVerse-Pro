import {
  openOpfsMediaFile,
  type OpfsMediaStoragePlatform,
  type OpfsMediaFile,
} from "@/lib/practice/media/opfs-media-file";

/** Temporary browser-generated derivatives have their own byte-storage lifetime. */
export async function openCompositeVideoOutputMedia(
  signal?: AbortSignal,
  platform?: OpfsMediaStoragePlatform,
): Promise<OpfsMediaFile> {
  try {
    return await openOpfsMediaFile(
      "noteverse-composite-video-output",
      signal,
      platform,
    );
  } catch (cause) {
    if (signal?.aborted)
      throw new DOMException("Export cancelled", "AbortError");
    throw new Error("composite_video_unavailable:output_storage", { cause });
  }
}
