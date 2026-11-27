import { reportUnexpectedClientError } from "@/lib/observability";
/** Each immutable asset reference owns the lifetime of its backing bytes. */
export interface LocalMediaAsset {
  readonly blob: Blob;
  readonly byteSize: number;
  retain(): LocalMediaAsset;
  release(): Promise<void>;
}

/** Backing bytes retire only after every explicit asset reference retires. */
export function createLocalMediaAsset(
  blob: Blob,
  remove: () => Promise<void>,
): LocalMediaAsset {
  let references = 0;
  const lease = (): LocalMediaAsset => {
    references++;
    let released: Promise<void> | null = null;
    return Object.freeze({
      blob,
      byteSize: blob.size,
      retain() {
        if (released) throw new Error("Media owner is retired.");
        return lease();
      },
      release() {
        if (!released) {
          references--;
          released =
            references === 0
              ? Promise.resolve().then(remove)
              : Promise.resolve();
        }
        return released;
      },
    });
  };
  return lease();
}

/** Published media retirement reports IO failure and leaves an unlocked orphan for recovery. */
export async function releaseLocalMediaAsset(
  asset: LocalMediaAsset,
): Promise<void> {
  try {
    await asset.release();
  } catch (error) {
    reportUnexpectedClientError(error, {
      area: "practice",
      operation: "media_backing_remove",
    });
  }
}
