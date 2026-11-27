// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { downloadCompositeVideo } from "./download";
import { downloadLocalMedia } from "@/lib/practice/media/download-local-media";
import { createLocalMediaAsset } from "@/lib/practice/media/local-media-asset";

vi.mock("@/lib/practice/media/download-local-media", () => ({
  downloadLocalMedia: vi.fn(),
}));
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:local-output");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.mocked(downloadLocalMedia).mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("hands exact browser-owned bytes to download before the OPFS output owner retires", async () => {
  const removed = vi.fn(async () => undefined);
  const output = createLocalMediaAsset(
    new Blob(["encoded video"], { type: "video/webm" }),
    removed,
  );
  vi.mocked(fetch).mockResolvedValue(
    new Response("encoded video", {
      headers: { "Content-Type": "video/webm" },
    }),
  );
  vi.mocked(downloadLocalMedia).mockImplementation(async (media, filename) => {
    await output.release();
    expect(removed).not.toHaveBeenCalled();
    expect(media.blob).not.toBe(output.blob);
    expect(await media.blob.text()).toBe("encoded video");
    expect(media.blob.type).toBe("video/webm");
    expect(filename).toBe("score-video.webm");
  });
  const signal = new AbortController().signal;
  await downloadCompositeVideo(output, "score-video.webm", signal);
  expect(fetch).toHaveBeenCalledExactlyOnceWith("blob:local-output", {
    signal,
  });
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
    "blob:local-output",
  );
  expect(removed).toHaveBeenCalledOnce();
});

it.each(["read", "download", "cancel"] as const)(
  "retires all handoff leases on %s failure",
  async (kind) => {
    const removed = vi.fn(async () => undefined);
    const output = createLocalMediaAsset(new Blob(["encoded"]), removed);
    const abort = new AbortController();
    const failure =
      kind === "cancel"
        ? new DOMException("Cancelled", "AbortError")
        : new Error("local download failed");
    vi.mocked(fetch).mockImplementation(async () => {
      await output.release();
      if (kind === "read") throw failure;
      if (kind === "cancel") {
        abort.abort();
        throw failure;
      }
      return new Response("encoded");
    });
    vi.mocked(downloadLocalMedia).mockRejectedValue(failure);
    await expect(
      downloadCompositeVideo(output, "score-video.webm", abort.signal),
    ).rejects.toBe(failure);
    expect(removed).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    if (kind !== "download") expect(downloadLocalMedia).not.toHaveBeenCalled();
  },
);
