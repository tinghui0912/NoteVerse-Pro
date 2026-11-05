import { vi } from 'vitest';
import type { RecordingSink, RecordingSinkFactory } from '../recording/recording-sink';
import { createOwnedMedia } from '../recording/owned-media';

export function ownedMediaFixture(blob = new Blob(['media'])) {
  return createOwnedMedia(blob, async () => {});
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
    seal: vi.fn(async mimeType => { sealed = true; return createOwnedMedia(new Blob(chunks, { type: mimeType }), remove); }),
    abort: vi.fn(async () => { if (!sealed) await remove(); }),
  };
  return { sink, remove, exists: () => live, open: vi.fn(async () => sink) };
}

export const memoryRecordingSinkFactory: RecordingSinkFactory = async () => recordingSinkFixture().sink;
