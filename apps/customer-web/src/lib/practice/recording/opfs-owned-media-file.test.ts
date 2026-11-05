// @vitest-environment node
import { expect, it } from "vitest";
import { openOpfsOwnedMediaFile } from "./opfs-owned-media-file";
import { opfsStoreFixture } from "../__fixtures__/opfs-store";

it("opens the lifetime lock before file creation and seals exact incrementally written bytes", async () => {
  const f = opfsStoreFixture();
  const create = f.directory.getFileHandle.getMockImplementation()!;
  f.directory.getFileHandle.mockImplementation(async (...args) => {
    expect(f.held.has("test-media:capture-1")).toBe(true);
    return create(...args);
  });
  const file = await openOpfsOwnedMediaFile(
    "test-media",
    undefined,
    f.platform,
  );
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
  const live = await openOpfsOwnedMediaFile(
    "test-media",
    undefined,
    f.platform,
  );
  f.files.set("capture-1.crswap", [new Blob(["pending"])]);
  const peer = await openOpfsOwnedMediaFile(
    "test-media",
    undefined,
    f.platform,
  );
  expect(f.files.has("capture-1.crswap")).toBe(true);
  await live.abort();
  const next = await openOpfsOwnedMediaFile(
    "test-media",
    undefined,
    f.platform,
  );
  expect(f.files.has("capture-1.crswap")).toBe(false);
  await peer.abort();
  await next.abort();
});
