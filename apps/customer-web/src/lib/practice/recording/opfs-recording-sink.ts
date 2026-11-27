import { RecordingFailure } from "@/lib/practice/failure/causal-failure";
import {
  openOpfsMediaFile,
  type OpfsMediaStoragePlatform,
} from "@/lib/practice/media/opfs-media-file";
import type { RecordingSink } from "./recording-sink";

/** Temporary uncommitted Capture bytes; no full-file heap materialization. */
export async function openOpfsRecordingSink(
  signal?: AbortSignal,
  platform?: OpfsMediaStoragePlatform,
): Promise<RecordingSink> {
  try {
    return await openOpfsMediaFile(
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
