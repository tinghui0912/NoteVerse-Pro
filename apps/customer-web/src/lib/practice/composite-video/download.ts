import { downloadLocalMedia } from "@/lib/practice/media/download-local-media";
import {
  createLocalMediaAsset,
  releaseLocalMediaAsset,
  type LocalMediaAsset,
} from "@/lib/practice/media/local-media-asset";

/** Browser-owned download bytes stay valid after the temporary OPFS output retires. */
export async function downloadCompositeVideo(
  output: LocalMediaAsset,
  filename: string,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const lease = output.retain();
  let url: string | null = null;
  let snapshot: LocalMediaAsset | null = null;
  try {
    url = URL.createObjectURL(lease.blob);
    // A native streaming Blob response snapshots file-backed bytes into the browser's
    // Blob store. No JS chunk array or whole-output ArrayBuffer is allocated.
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error("composite_video_failed:download_read");
    snapshot = createLocalMediaAsset(
      await response.blob(),
      async () => undefined,
    );
    signal?.throwIfAborted();
    await downloadLocalMedia(snapshot, filename);
  } finally {
    if (url) URL.revokeObjectURL(url);
    if (snapshot) await releaseLocalMediaAsset(snapshot);
    await releaseLocalMediaAsset(lease);
  }
}
