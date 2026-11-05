// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { openOpfsMediaFile } from "./opfs-media-file";
import { opfsStoreFixture } from "../__fixtures__/opfs-store";

it("opens the lifetime lock before file creation and seals exact incrementally written bytes", async () => {
  const f = opfsStoreFixture();
  const create = f.directory.getFileHandle.getMockImplementation()!;
  f.directory.getFileHandle.mockImplementation(async (...args) => {
    expect(f.held.has("test-media:capture-1")).toBe(true);
    return create(...args);
  });
  const file = await openOpfsMediaFile("test-media", undefined, f.platform);
  await file.append(new Uint8Array([1, 2]));
  await file.append(new Uint8Array([3]));
  expect(file.byteSize).toBe(3);
  expect(f.close).not.toHaveBeenCalled();
  const media = await file.seal("video/webm");
  expect([...new Uint8Array(await media.blob.arrayBuffer())]).toEqual([
    1, 2, 3,
  ]);
  const lease = media.retain();
  await media.release();
  expect(f.held.size).toBe(1);
  await lease.release();
  expect(f.held.size).toBe(0);
  expect(f.files.size).toBe(0);
});
// A native writable may expose its temporary sidecar while the owner holds the file lock.
it("protects an active writer's sidecar and reclaims it after its owner disappears", async () => {
  const f = opfsStoreFixture();
  const live = await openOpfsMediaFile("test-media", undefined, f.platform);
  f.files.set("capture-1.crswap", [new Blob(["pending"])]);
  const peer = await openOpfsMediaFile("test-media", undefined, f.platform);
  expect(f.files.has("capture-1.crswap")).toBe(true);
  await live.abort();
  const next = await openOpfsMediaFile("test-media", undefined, f.platform);
  expect(f.files.has("capture-1.crswap")).toBe(false);
  await peer.abort();
  await next.abort();
});

vi.mock("@/lib/observability", () => ({
  reportUnexpectedClientError: vi.fn(),
}));
afterEach(() => {
  vi.clearAllMocks();
});

function deferred() {
  let resolve!: () => void, reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const flush = async () => {
  for (let index = 0; index < 20; index++) await Promise.resolve();
};

it("serializes A/B writes and drains every accepted append before closing the file", async () => {
  const f = opfsStoreFixture(),
    a = deferred(),
    b = deferred(),
    order: Blob[] = [];
  const original = f.write.getMockImplementation()!;
  const first = new Blob(["A"]),
    second = new Blob(["BB"]);
  f.write.mockImplementation(async (id, chunk) => {
    order.push(chunk);
    await (chunk === first ? a.promise : b.promise);
    await original(id, chunk);
  });
  const file = await openOpfsMediaFile("test-media", undefined, f.platform);
  const writingA = file.append(first),
    writingB = file.append(second),
    sealed = file.seal("video/webm");
  await flush();
  expect(order).toEqual([first]);
  expect(f.close).not.toHaveBeenCalled();
  a.resolve();
  await writingA;
  await flush();
  expect(order).toEqual([first, second]);
  expect(f.close).not.toHaveBeenCalled();
  b.resolve();
  await writingB;
  const asset = await sealed;
  expect(await asset.blob.text()).toBe("ABB");
  expect(asset.byteSize).toBe(3);
  expect(f.close).toHaveBeenCalledOnce();
  await asset.release();
  expect(f.files.size).toBe(0);
  expect(f.held.size).toBe(0);
});
it("fails closed on a final file-size mismatch and aborts its untransferred bytes", async () => {
  const f = opfsStoreFixture();
  f.write.mockImplementation(async () => {});
  const file = await openOpfsMediaFile("test-media", undefined, f.platform);
  await file.append(new Blob(["bytes"]));
  await expect(file.seal("video/webm")).rejects.toThrow("byte size mismatch");
  await file.abort();
  await file.abort();
  expect(f.files.size).toBe(0);
  expect(f.remove).toHaveBeenCalledOnce();
  expect(f.held.size).toBe(0);
});
it("aborts an OPEN writer before joining a pending write, exactly once", async () => {
  const f = opfsStoreFixture(),
    write = deferred();
  f.write.mockImplementation(async () => write.promise);
  f.abort.mockImplementation(async () => {
    write.reject(new Error("write cancelled"));
  });
  const file = await openOpfsMediaFile("test-media", undefined, f.platform);
  const writing = file.append(new Blob(["pending"]));
  const rejected = expect(writing).rejects.toThrow("write cancelled");
  await flush();
  const aborting = file.abort();
  expect(file.abort()).toBe(aborting);
  await rejected;
  await aborting;
  expect(f.abort).toHaveBeenCalledOnce();
  expect(f.remove).toHaveBeenCalledOnce();
  expect(f.held.size).toBe(0);
});
it("rejects an aborted SEALING operation without creating a published asset", async () => {
  const f = opfsStoreFixture(),
    closing = deferred();
  f.close.mockImplementation(async () => closing.promise);
  const file = await openOpfsMediaFile("test-media", undefined, f.platform);
  await file.append(new Blob(["bytes"]));
  const sealing = file.seal("video/webm"),
    rejected = expect(sealing).rejects.toThrow("abandoned");
  await flush();
  expect(f.close).toHaveBeenCalledOnce();
  const aborting = file.abort();
  closing.resolve();
  await rejected;
  await aborting;
  expect(f.files.size).toBe(0);
  expect(f.remove).toHaveBeenCalledOnce();
  expect(f.held.size).toBe(0);
});
it.each(["file open", "writer open"] as const)(
  "retires the lock and partial file after %s failure",
  async (stage) => {
    const f = opfsStoreFixture(),
      create = f.directory.getFileHandle.getMockImplementation()!;
    f.directory.getFileHandle.mockImplementation(async (...args) => {
      if (stage === "file open") throw new Error("open failed");
      const file = await create(...args);
      return {
        ...file,
        createWritable: async () => {
          throw new Error("writer failed");
        },
      };
    });
    await expect(
      openOpfsMediaFile("test-media", undefined, f.platform),
    ).rejects.toThrow("OPFS media storage unavailable");
    expect(f.files.size).toBe(0);
    expect(f.remove).toHaveBeenCalledOnce();
    expect(f.held.size).toBe(0);
  },
);
it("retires an unsealed file whose close fails and preserves that failure", async () => {
  const f = opfsStoreFixture();
  f.close.mockRejectedValueOnce(new Error("close failed"));
  const file = await openOpfsMediaFile("test-media", undefined, f.platform);
  await file.append(new Blob(["bytes"]));
  await expect(file.seal("video/webm")).rejects.toThrow("close failed");
  await file.abort();
  expect(f.abort).toHaveBeenCalledOnce();
  expect(f.files.size).toBe(0);
  expect(f.held.size).toBe(0);
});
it("removes bytes and releases the lock even if the writer abort fails", async () => {
  const f = opfsStoreFixture();
  f.abort.mockRejectedValueOnce(new Error("writer abort failed"));
  const file = await openOpfsMediaFile("test-media", undefined, f.platform);
  await expect(file.abort()).rejects.toThrow("writer abort failed");
  expect(f.remove).toHaveBeenCalledOnce();
  expect(f.files.size).toBe(0);
  expect(f.held.size).toBe(0);
});
it("unlocks a failed removal, memoizes retirement failure and lets initialization reclaim the orphan", async () => {
  const f = opfsStoreFixture();
  f.remove.mockRejectedValueOnce(new Error("remove failed"));
  const file = await openOpfsMediaFile("test-media", undefined, f.platform);
  const retirement = file.abort();
  await expect(retirement).rejects.toThrow("remove failed");
  expect(file.abort()).toBe(retirement);
  expect(f.remove).toHaveBeenCalledOnce();
  expect(f.files.size).toBe(1);
  expect(f.held.size).toBe(0);
  const next = await openOpfsMediaFile("test-media", undefined, f.platform);
  expect(f.files.has("capture-1")).toBe(false);
  await next.abort();
  expect(f.files.size).toBe(0);
  expect(f.held.size).toBe(0);
});
it("final asset removal failure retires that owner without retaining the file lock", async () => {
  const f = opfsStoreFixture(),
    file = await openOpfsMediaFile("test-media", undefined, f.platform);
  await file.append(new Blob(["bytes"]));
  const asset = await file.seal("video/webm");
  f.remove.mockRejectedValueOnce(new Error("remove failed"));
  const retirement = asset.release();
  await expect(retirement).rejects.toThrow("remove failed");
  expect(asset.release()).toBe(retirement);
  expect(() => asset.retain()).toThrow("retired");
  expect(f.remove).toHaveBeenCalledOnce();
  expect(f.held.size).toBe(0);
  const next = await openOpfsMediaFile("test-media", undefined, f.platform);
  await next.abort();
  expect(f.files.size).toBe(0);
});
