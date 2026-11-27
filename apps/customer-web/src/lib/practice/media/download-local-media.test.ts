// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { downloadLocalMedia } from "./download-local-media";
import { createLocalMediaAsset } from "./local-media-asset";

beforeEach(() => {
  vi.stubGlobal("URL", { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it.each(["video/webm", "video/mp4"])(
  "retains the same %s source until its object URL is revoked",
  async (mimeType) => {
    vi.useFakeTimers();
    const remove = vi.fn(async () => {});
    const media = createLocalMediaAsset(
      new Blob(["raw"], { type: mimeType }),
      remove,
    );
    const create = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:raw-file");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const pending = downloadLocalMedia(
      media,
      `capture.${mimeType.endsWith("mp4") ? "mp4" : "webm"}`,
    );
    expect(create).toHaveBeenCalledExactlyOnceWith(media.blob);
    expect(click).toHaveBeenCalledOnce();
    await media.release();
    expect(remove).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    await pending;
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:raw-file");
    expect(remove).toHaveBeenCalledOnce();
  },
);

it("releases the operation on an anchor failure and still revokes its URL", async () => {
  const remove = vi.fn(async () => {});
  const media = createLocalMediaAsset(
    new Blob(["raw"], { type: "video/mp4" }),
    remove,
  );
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:raw-file");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
    throw new Error("anchor failed");
  });
  await expect(downloadLocalMedia(media, "capture.mp4")).rejects.toThrow(
    "anchor failed",
  );
  expect(remove).not.toHaveBeenCalled();
  expect(revoke).toHaveBeenCalledOnce();
  await media.release();
  expect(remove).toHaveBeenCalledOnce();
});
