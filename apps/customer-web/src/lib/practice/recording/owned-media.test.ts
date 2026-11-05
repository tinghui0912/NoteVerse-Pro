import { expect, it, vi } from "vitest";
import { createOwnedMedia, releaseOwnedMedia } from "./owned-media";
import { reportUnexpectedClientError } from "@/lib/observability";
vi.mock("@/lib/observability", () => ({
  reportUnexpectedClientError: vi.fn(),
}));

it("each handle owns its bytes and an independent idempotent reference", async () => {
  const blob = new Blob(["bytes"]),
    remove = vi.fn(async () => {});
  const first = createOwnedMedia(blob, remove),
    second = first.retain(),
    third = first.retain();
  expect(first.blob).toBe(blob);
  expect(first.byteSize).toBe(5);
  expect(second).not.toBe(first);
  expect(second.blob).toBe(blob);
  expect(second.release()).toBe(second.release());
  await first.release();
  expect(() => first.retain()).toThrow("retired");
  expect(remove).not.toHaveBeenCalled();
  await third.release();
  await third.release();
  expect(remove).toHaveBeenCalledOnce();
  expect(() => third.retain()).toThrow("retired");
});
it("reports failed last-owner retirement without retrying or permitting resurrection", async () => {
  const remove = vi.fn(async () => {
    throw new Error("disk denied");
  });
  const media = createOwnedMedia(new Blob(["raw"]), remove);
  await releaseOwnedMedia(media);
  await releaseOwnedMedia(media);
  expect(remove).toHaveBeenCalledOnce();
  expect(reportUnexpectedClientError).toHaveBeenCalled();
  expect(() => media.retain()).toThrow("retired");
});
