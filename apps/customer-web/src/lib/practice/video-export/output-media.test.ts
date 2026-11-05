// @vitest-environment node
import { expect, it } from "vitest";
import { opfsStoreFixture } from "../__fixtures__/opfs-store";
import { openVideoExportOutputMedia } from "./output-media";

const namespace = "noteverse-video-export-output";
it("uses the derivative namespace and a per-file lock spanning all output owners", async () => {
  const f = opfsStoreFixture(),
    create = f.directory.getFileHandle.getMockImplementation()!;
  f.directory.getFileHandle.mockImplementation(async (...args) => {
    expect(f.held.has(`${namespace}:${args[0]}`)).toBe(true);
    return create(...args);
  });
  const file = await openVideoExportOutputMedia(undefined, f.platform);
  expect(f.directory.getDirectoryHandle).toHaveBeenCalledWith(namespace, {
    create: true,
  });
  await file.append(new Blob(["encoded"]));
  const media = await file.seal("video/webm");
  const retained = media.retain();
  await media.release();
  expect(f.held.size).toBe(1);
  await retained.release();
  expect(f.held.size).toBe(0);
  expect(f.files.size).toBe(0);
});
it("reclaims unlocked output orphans and sidecars while protecting another tab’s locked output", async () => {
  const f = opfsStoreFixture();
  for (const name of ["orphan", "orphan.crswap", "active", "active.crswap"])
    f.files.set(name, []);
  f.held.add(`${namespace}:active`);
  const file = await openVideoExportOutputMedia(undefined, f.platform);
  expect(f.files.has("orphan")).toBe(false);
  expect(f.files.has("orphan.crswap")).toBe(false);
  expect(f.files.has("active")).toBe(true);
  expect(f.files.has("active.crswap")).toBe(true);
  await file.abort();
  f.held.delete(`${namespace}:active`);
  const next = await openVideoExportOutputMedia(undefined, f.platform);
  expect(f.files.has("active")).toBe(false);
  expect(f.files.has("active.crswap")).toBe(false);
  await next.abort();
  expect(f.files.size).toBe(0);
});
it("fails unavailable on writer creation failure and removes the partial file and lock", async () => {
  const f = opfsStoreFixture();
  f.directory.getFileHandle.mockResolvedValueOnce({
    createWritable: async () => {
      throw new Error("storage unavailable");
    },
    getFile: async () => new File([], "unused"),
  });
  await expect(
    openVideoExportOutputMedia(undefined, f.platform),
  ).rejects.toThrow("video_export_unavailable:output_storage");
  expect(f.files.size).toBe(0);
  expect(f.held.size).toBe(0);
});
