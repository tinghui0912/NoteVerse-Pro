import { RecordingFailure } from "@/lib/practice/failure/causal-failure";
import {
  openOpfsOwnedMediaFile,
  type OpfsMediaStoragePlatform,
} from "./opfs-owned-media-file";
import type { RecordingSink } from "./recording-sink";

/** Temporary uncommitted Capture bytes; no full-file heap materialization. */
export async function openOpfsRecordingSink(
  signal?: AbortSignal,
  platform?: OpfsMediaStoragePlatform,
): Promise<RecordingSink> {
  try {
    return await openOpfsOwnedMediaFile(
      "noteverse-practice-captures",
      signal,
      platform,
      "noteverse-practice-capture",
    );
  } catch (cause) {
    if (signal?.aborted) throw signal.reason;
    throw new RecordingFailure("RECORDING_STORAGE_UNAVAILABLE", { cause });
  }
}
