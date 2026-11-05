import { reportUnexpectedClientError } from "@/lib/observability";
/** Each immutable handle owns one reference to these backing bytes. */
export interface OwnedMediaHandle {
  readonly blob: Blob;
  readonly byteSize: number;
  retain(): OwnedMediaHandle;
  release(): Promise<void>;
}

/** A sealed file is deleted only after every explicit owner retires. */
export function createOwnedMedia(
  blob: Blob,
  remove: () => Promise<void>,
): OwnedMediaHandle {
  let references = 0;
  const lease = (): OwnedMediaHandle => {
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
export async function releaseOwnedMedia(
  resource: OwnedMediaHandle,
): Promise<void> {
  try {
    await resource.release();
  } catch (error) {
    reportUnexpectedClientError(error, {
      area: "practice",
      operation: "media_backing_remove",
    });
  }
}
