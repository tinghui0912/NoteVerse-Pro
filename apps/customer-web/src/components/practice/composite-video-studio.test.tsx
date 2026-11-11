// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { CompositeVideoStudio } from "./composite-video-studio";
import { exportCompositeVideo } from "@/lib/practice/composite-video/export";
import { downloadCompositeVideo } from "@/lib/practice/composite-video/download";
import { createLocalMediaAsset } from "@/lib/practice/media/local-media-asset";
import { admitSavedRecordedPerformance } from "@/lib/practice/archive/saved-performance";
import {
  take,
  artifact,
} from "@/lib/practice/composite-video/__fixtures__/saved-take";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/practice/composite-video/preview", () => ({
  CompositeVideoPreview: () => null,
}));
vi.mock("@/lib/practice/composite-video/export", () => ({
  exportCompositeVideo: vi.fn(),
  getCompositeVideoReadiness: () => ({ ok: true, mimeType: "video/webm" }),
}));
vi.mock("@/lib/practice/composite-video/download", () => ({
  downloadCompositeVideo: vi.fn(),
}));

function studio() {
  const sourceRemoved = vi.fn(async () => {}),
    outputRemoved = vi.fn(async () => {});
  const source = createLocalMediaAsset(new Blob(["source1234"]), sourceRemoved);
  const output = createLocalMediaAsset(
    new Blob(["derivative"], { type: "video/webm" }),
    outputRemoved,
  );
  const adapted = admitSavedRecordedPerformance(
    take,
    {
      binding: {
        scoreId: "score-1",
        revisionId: "revision-1",
        bundleId: take.manifest.practice_binding.bundle_id,
      },
      artifact,
    },
    source,
  );
  if (adapted.status !== "supported") throw new Error("Expected video");
  vi.mocked(exportCompositeVideo).mockResolvedValue({
    media: output,
    mimeType: "video/webm",
    durationMs: 4000,
  });
  const exporting = vi.fn();
  const view = render(
    <CompositeVideoStudio
      input={{
        recordedPerformance: adapted.recordedPerformance,
        musicXml: "<score />",
      }}
      open
      onOpenChange={vi.fn()}
      onExportingChange={exporting}
    />,
  );
  const start = () =>
    fireEvent.click(screen.getByTestId("generate-composite-video"));
  return {
    view,
    start,
    source,
    output,
    sourceRemoved,
    outputRemoved,
    exporting,
  };
}
beforeEach(() => {
  vi.mocked(exportCompositeVideo).mockReset();
  vi.mocked(downloadCompositeVideo).mockReset();
  vi.mocked(downloadCompositeVideo).mockResolvedValue();
});
afterEach(() => {
  vi.restoreAllMocks();
});

it("downloads the output handle and retires its owner independently from the source lease", async () => {
  const f = studio();
  let finish!: () => void;
  vi.mocked(downloadCompositeVideo).mockImplementation(async (media) => {
    const lease = media.retain();
    try {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    } finally {
      await lease.release();
    }
  });
  f.start();
  await waitFor(() => expect(downloadCompositeVideo).toHaveBeenCalledOnce());
  expect(downloadCompositeVideo).toHaveBeenCalledWith(
    f.output,
    expect.stringMatching(/^performance-score-video-.*\.webm$/),
    expect.any(AbortSignal),
  );
  await f.source.release();
  expect(f.sourceRemoved).toHaveBeenCalledOnce();
  expect(f.outputRemoved).not.toHaveBeenCalled();
  await act(async () => {
    finish();
  });
  await waitFor(() => expect(f.outputRemoved).toHaveBeenCalledOnce());
  expect(f.sourceRemoved).toHaveBeenCalledOnce();
  expect(screen.getByTestId("composite-video-success")).toBeDefined();
});
it("releases the result owner even if the download click fails", async () => {
  const f = studio();
  vi.mocked(downloadCompositeVideo).mockRejectedValueOnce(
    new Error("click failed"),
  );
  f.start();
  await waitFor(() => expect(f.outputRemoved).toHaveBeenCalledOnce());
  expect(screen.getByTestId("composite-video-error")).toBeDefined();
  await f.source.release();
  expect(f.sourceRemoved).toHaveBeenCalledOnce();
});
it.each(["cancel", "unmount"] as const)(
  "%s aborts active output, holds source until cleanup and rejects late output publication",
  async (action) => {
    const f = studio();
    let finish!: (
      value: Awaited<ReturnType<typeof exportCompositeVideo>>,
    ) => void;
    vi.mocked(exportCompositeVideo).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    f.start();
    await waitFor(() => expect(exportCompositeVideo).toHaveBeenCalledOnce());
    const signal = vi.mocked(exportCompositeVideo).mock.calls[0][0].signal!;
    await f.source.release();
    expect(f.sourceRemoved).toHaveBeenCalledOnce();
    if (action === "cancel")
      fireEvent.click(screen.getByText("cancelExportScoreVideo"));
    else f.view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      finish({ media: f.output, mimeType: "video/webm", durationMs: 4000 });
    });
    await waitFor(() => expect(f.outputRemoved).toHaveBeenCalledOnce());
    expect(f.sourceRemoved).toHaveBeenCalledOnce();
    expect(downloadCompositeVideo).not.toHaveBeenCalled();
  },
);
it("surfaces an operation-state listener failure without starting export", async () => {
  const f = studio();
  f.exporting.mockImplementationOnce(() => {
    throw new Error("status failed");
  });
  f.start();
  await waitFor(() =>
    expect(screen.getByTestId("composite-video-error")).toBeDefined(),
  );
  expect(exportCompositeVideo).not.toHaveBeenCalled();
  await f.source.release();
  expect(f.sourceRemoved).toHaveBeenCalledOnce();
  await f.output.release();
});
