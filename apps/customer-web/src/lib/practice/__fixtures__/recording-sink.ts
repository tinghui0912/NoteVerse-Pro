import { vi } from 'vitest';
import type { RecordingSink, RecordingSinkFactory, SealedRecordingMedia } from '../recording/recording-sink';
import { createRecordingMediaResource } from '../recording/recording-media-resource';

export function recordingResourceFixture() {
  return createRecordingMediaResource(async () => {});
}

/** Memory exists only in this injected deterministic test double. */
export function recordingSinkFixture() {
  const chunks: Blob[] = [];
  let bytes = 0;
  let live = true;
  let sealed = false;
  const remove = vi.fn(async () => { live = false; });
  const sink: RecordingSink = {
    get byteSize() { return bytes; },
    append: vi.fn(async chunk => { chunks.push(chunk); bytes += chunk.size; }),
    seal: vi.fn(async mimeType => { sealed = true; return { blob: new Blob(chunks, { type: mimeType }), byteSize: bytes,
      resource: createRecordingMediaResource(remove) } satisfies SealedRecordingMedia; }),
    abort: vi.fn(async () => { if (!sealed) await remove(); }),
  };
  return { sink, remove, exists: () => live, open: vi.fn(async () => sink) };
}

export const memoryRecordingSinkFactory: RecordingSinkFactory = async () => recordingSinkFixture().sink;
