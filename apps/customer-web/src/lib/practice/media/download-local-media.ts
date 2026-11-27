import { releaseLocalMediaAsset } from "@/lib/practice/media/local-media-asset";
import type { LocalMediaAsset } from "./local-media-asset";

/** The object URL and the browser download retain their backing file until URL retirement. */
export async function downloadLocalMedia(
  media: LocalMediaAsset,
  filename: string,
): Promise<void> {
  const lease = media.retain();
  let url: string | null = null;
  let anchor: HTMLAnchorElement | null = null;
  try {
    url = URL.createObjectURL(lease.blob);
    anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  } finally {
    anchor?.remove();
    try {
      if (url) URL.revokeObjectURL(url);
    } finally {
      await releaseLocalMediaAsset(lease);
    }
  }
}
