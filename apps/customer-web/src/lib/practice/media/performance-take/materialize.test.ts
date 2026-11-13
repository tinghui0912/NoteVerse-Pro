// @vitest-environment node
import { openPerformanceTakeMedia } from "@/lib/api/performance-takes";
import { afterEach, expect, it, vi } from "vitest";
import { opfsStoreFixture } from "../../__fixtures__/opfs-store";
import type { OpfsMediaStoragePlatform } from "../opfs-media-file";
import { materializePerformanceTakeMedia } from "./materialize";
vi.mock("@/lib/api/performance-takes", () => ({ openPerformanceTakeMedia: vi.fn() }));
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
const options = () => ({
  takeId: "take/a",
  expectedByteSize: 6,
  expectedMimeType: "video/webm",
  signal: new AbortController().signal,
});
function response(
  chunks = ["abc", "def"],
  headers: Record<string, string> = {
    "content-type": "video/webm",
    "content-length": "6",
  },
) {
  const encoder = new TextEncoder();
  let index = 0;
  return new Response(
    new ReadableStream(
      {
        pull(controller) {
          if (index === chunks.length) controller.close();
          else controller.enqueue(encoder.encode(chunks[index++]));
        },
      },
      { highWaterMark: 0 },
    ),
    { headers },
  );
}
it.each([true, false])(
  "streams incrementally with progress and content-length present=%s",
  async (length) => {
    const f = opfsStoreFixture(),
      progress = vi.fn();
    vi.mocked(openPerformanceTakeMedia).mockResolvedValue(
      response(
        undefined,
        length ? undefined : { "content-type": "video/webm" },
      ),
    );
    const media = await materializePerformanceTakeMedia(
      { ...options(), onProgress: progress },
      f.platform,
    );
    expect(openPerformanceTakeMedia).toHaveBeenCalledWith(
      "take/a",
      expect.any(AbortSignal),
    );
    expect(progress.mock.calls).toEqual([
      [3, 6],
      [6, 6],
    ]);
    expect(f.write).toHaveBeenCalledTimes(2);
    expect(f.directory.getDirectoryHandle).toHaveBeenCalledWith(
      "noteverse-performance-take-media",
      { create: true },
    );
    expect(media.byteSize).toBe(6);
    expect(await media.blob.text()).toBe("abcdef");
    const exportLease = media.retain();
    await media.release();
    expect(f.files.size).toBe(1);
    await exportLease.release();
    expect(f.files.size).toBe(0);
    expect(f.held.size).toBe(0);
  },
);
it.each(["0", "-1", "NaN", "Infinity", "7", "6.5"])(
  "rejects mismatching/invalid HTTP size %s without publishing media",
  async (length) => {
    const f = opfsStoreFixture();
    vi.mocked(openPerformanceTakeMedia).mockResolvedValue(
      response(undefined, {
        "content-type": "video/webm",
        "content-length": length,
      }),
    );
    await expect(
      materializePerformanceTakeMedia(options(), f.platform),
    ).rejects.toMatchObject({ reason: "media_size_mismatch" });
    expect(f.files.size).toBe(0);
    expect(f.held.size).toBe(0);
  },
);
it.each([{ chunks: ["abc"] }, { chunks: ["abc", "def", "extra"] }])(
  "requires streamed bytes to equal durable Take size %#",
  async ({ chunks }) => {
    const f = opfsStoreFixture();
    vi.mocked(openPerformanceTakeMedia).mockResolvedValue(
      response(chunks, { "content-type": "video/webm" }),
    );
    await expect(
      materializePerformanceTakeMedia(options(), f.platform),
    ).rejects.toMatchObject({ reason: "media_size_mismatch" });
    expect(f.files.size).toBe(0);
    expect(f.held.size).toBe(0);
  },
);
it.each(["audio/webm", "application/octet-stream", ""])(
  "rejects incompatible response MIME %s",
  async (mime) => {
    const f = opfsStoreFixture();
    vi.mocked(openPerformanceTakeMedia).mockResolvedValue(
      response(undefined, { "content-type": mime }),
    );
    await expect(
      materializePerformanceTakeMedia(options(), f.platform),
    ).rejects.toMatchObject({ reason: "media_type_mismatch" });
    expect(f.files.size).toBe(0);
  },
);
it("supports MIME parameters while preserving durable MIME on the file-backed view", async () => {
  const f = opfsStoreFixture();
  vi.mocked(openPerformanceTakeMedia).mockResolvedValue(
    response(undefined, { "content-type": "video/webm; codecs=vp9" }),
  );
  const media = await materializePerformanceTakeMedia(options(), f.platform);
  expect(media.blob.type).toBe("video/webm");
  await media.release();
});
it("requires a streaming response and OPFS, with no memory substitute", async () => {
  vi.mocked(openPerformanceTakeMedia).mockResolvedValue(new Response(null));
  await expect(
    materializePerformanceTakeMedia(options()),
  ).rejects.toMatchObject({
    reason: "stream_unavailable",
  });
  vi.mocked(openPerformanceTakeMedia).mockResolvedValue(response());
  vi.stubGlobal("navigator", { storage: {} });
  await expect(
    materializePerformanceTakeMedia(options()),
  ).rejects.toMatchObject({
    reason: "storage_unavailable",
  });
});
it("aborts a pending reader, removes partial bytes and releases the file lock", async () => {
  const f = opfsStoreFixture(),
    abort = new AbortController(),
    cancel = vi.fn();
  let pulls = 0;
  vi.mocked(openPerformanceTakeMedia).mockResolvedValue(
    new Response(
      new ReadableStream(
        {
          pull(controller) {
            if (pulls++ === 0)
              controller.enqueue(new TextEncoder().encode("abc"));
          },
          cancel,
        },
        { highWaterMark: 0 },
      ),
      { headers: { "content-type": "video/webm" } },
    ),
  );
  const pending = materializePerformanceTakeMedia(
    {
      ...options(),
      signal: abort.signal,
      onProgress: () =>
        abort.abort(new DOMException("cancelled", "AbortError")),
    },
    f.platform,
  );
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(cancel).toHaveBeenCalledOnce();
  expect(f.abort).toHaveBeenCalledOnce();
  expect(f.files.size).toBe(0);
  expect(f.held.size).toBe(0);
});
it("writer failure cancels source and removes partial storage", async () => {
  const f = opfsStoreFixture();
  f.write.mockRejectedValueOnce(new Error("quota"));
  vi.mocked(openPerformanceTakeMedia).mockResolvedValue(response());
  await expect(
    materializePerformanceTakeMedia(options(), f.platform),
  ).rejects.toMatchObject({ reason: "download_failed" });
  expect(f.abort).toHaveBeenCalledOnce();
  expect(f.files.size).toBe(0);
  expect(f.held.size).toBe(0);
});
it("reclaims only unlocked downloaded-media orphans, preserving another tab owner", async () => {
  const f = opfsStoreFixture();
  vi.mocked(openPerformanceTakeMedia).mockImplementation(async () => response());
  const live = await materializePerformanceTakeMedia(options(), f.platform);
  f.files.set("crashed", [new Blob(["partial"])]);
  const next = await materializePerformanceTakeMedia(options(), f.platform);
  expect(f.files.has("crashed")).toBe(false);
  expect(f.files.size).toBe(2);
  await next.release();
  expect(f.files.size).toBe(1);
  await live.release();
  expect(f.files.size).toBe(0);
});
it("accepts a large lazy logical stream with one bounded chunk and a counting file writer", async () => {
  const total = 151 * 1024 * 1024,
    chunkSize = 64 * 1024;
  let produced = 0,
    written = 0,
    inFlight = 0,
    maxInFlight = 0,
    removed = 0;
  const source = new ReadableStream<Uint8Array<ArrayBuffer>>(
    {
      pull(controller) {
        if (produced === total) {
          controller.close();
          return;
        }
        const size = Math.min(chunkSize, total - produced);
        produced += size;
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        controller.enqueue(new Uint8Array(size));
      },
    },
    { highWaterMark: 0 },
  );
  const virtualBlob = new Blob([]);
  Object.defineProperty(virtualBlob, "size", { value: total });
  const file = {
    createWritable: async () => ({
      write: async (chunk: unknown) => {
        written += (chunk as Uint8Array).byteLength;
        inFlight--;
      },
      close: async () => {},
      abort: async () => {},
    }),
    getFile: async () => ({ size: total, slice: () => virtualBlob }) as File,
  };
  const directory = {
    getDirectoryHandle: async () => directory,
    getFileHandle: async () => file,
    removeEntry: async () => {
      removed++;
    },
    async *values() {},
  };
  const platform: OpfsMediaStoragePlatform = {
    root: async () => directory,
    randomId: () => "large",
    locks: {
      request: async (
        _name: unknown,
        _options: unknown,
        callback: () => Promise<void>,
      ) => callback(),
    } as unknown as LockManager,
  };
  vi.mocked(openPerformanceTakeMedia).mockResolvedValue(
    new Response(source, {
      headers: {
        "content-type": "video/webm",
        "content-length": String(total),
      },
    }),
  );
  const media = await materializePerformanceTakeMedia(
    { ...options(), expectedByteSize: total },
    platform,
  );
  expect(written).toBe(total);
  expect(media.byteSize).toBe(total);
  expect(maxInFlight).toBe(1);
  await media.release();
  expect(removed).toBe(1);
});
