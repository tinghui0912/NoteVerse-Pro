import { localMediaAssetFixture } from "@/lib/practice/__fixtures__/local-media-asset";
import { createLocalMediaAsset } from "@/lib/practice/media/local-media-asset";
// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import practice from "@/../messages/en/practice.json";
import {
  take,
  artifact,
} from "@/lib/practice/composite-video/__fixtures__/saved-take";
import { ApiError } from "@/lib/api-client";
import Page from "./page";

const calls = vi.hoisted(() => ({
  get: vi.fn(),
  media: vi.fn(),
  player: vi.fn(),
  studio: vi.fn(),
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ takeId: "take-1" }),
  useRouter: () => ({ push: calls.push }),
}));
vi.mock("@/hooks/queries/use-performance-take-queries", () => ({
  usePerformanceTakeDetail: () => ({ data: { data: take }, isLoading: false }),
}));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiClient: { get: calls.get },
}));
vi.mock("@/lib/practice/media/performance-take/materialize", () => ({
  materializePerformanceTakeMedia: calls.media,
}));
vi.mock("@/components/practice/recording-playback-player", () => ({
  RecordingPlaybackPlayer: (props: { actions: React.ReactNode }) => {
    calls.player(props);
    return <div data-testid="raw-source">{props.actions}</div>;
  },
}));
vi.mock("@/components/practice/composite-video-studio", () => ({
  CompositeVideoStudio: (props: { recordedPerformance: unknown }) => {
    calls.studio(props);
    return <div data-testid="score-export" />;
  },
}));
vi.mock("@/components/score-preview/verovio-score-viewer", () => ({
  VerovioScoreViewer: () => <div data-testid="score" />,
}));
vi.mock("@/lib/practice/score-view/verovio-adapter", () => ({
  PracticeVerovioAdapter: class {
    dispose() {}
  },
}));

const blob = new Blob(["raw video!"], { type: "video/webm" });
beforeEach(() => {
  vi.clearAllMocks();
  calls.media.mockResolvedValue(localMediaAssetFixture(blob));
  calls.get.mockResolvedValue({
    data: {
      binding: {
        score_id: take.manifest.practice_binding.score_id,
        revision_id: take.manifest.practice_binding.revision_id,
        bundle_id: take.manifest.practice_binding.bundle_id,
      },
      artifact: structuredClone(artifact),
      notation: {
        musicxml: "<score />",
        mime_type: "application/vnd.recordare.musicxml+xml",
      },
    },
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  URL.createObjectURL = vi.fn(() => "blob:raw");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function openPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={{ practice }}>
        <Page />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}
it("loads exact currently authorized Bundle for optional saved score export", async () => {
  openPage();
  await screen.findByTestId("score-export");
  expect(calls.get).toHaveBeenCalledExactlyOnceWith(
    `/practice/scores/${take.manifest.practice_binding.score_id}/revisions/${take.manifest.practice_binding.revision_id}/bundle`,
    { include_notation: true },
    { signal: expect.any(AbortSignal) },
  );
  expect(calls.player.mock.calls.at(-1)![0].source.media.blob).toBe(blob);
  const recorded = calls.studio.mock.calls.at(-1)![0].input.recordedPerformance;
  expect(calls.player.mock.calls.at(-1)![0].source.media).toBe(
    recorded.recording.media,
  );
  expect(calls.player.mock.calls.at(-1)![0].source.recordingTimebase).toBe(
    recorded.recording.timebase,
  );
});
it.each([403, 404])(
  "keeps raw source and download usable when Bundle authorization returns %s",
  async (status) => {
    calls.get.mockRejectedValue(
      new ApiError(status, "resource_not_found", "Unavailable"),
    );
    openPage();
    await screen.findByTestId("raw-source");
    await screen.findByText(
      practice.savedTakeCompositeVideoRevisionUnavailable,
    );
    expect(screen.queryByTestId("score-export")).toBeNull();
    expect(calls.player.mock.calls.at(-1)![0].source.media.blob).toBe(blob);
    fireEvent.click(
      screen.getByRole("button", { name: practice.downloadOriginalRecording }),
    );
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    await waitFor(() =>
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:raw"),
    );
    await waitFor(() => expect(calls.get).toHaveBeenCalledTimes(1));
  },
);
it("refuses different exact representation identity while retaining raw media", async () => {
  calls.get.mockResolvedValue({
    data: {
      binding: {
        score_id: take.manifest.practice_binding.score_id,
        revision_id: take.manifest.practice_binding.revision_id,
        bundle_id: "another-bundle",
      },
      artifact,
      notation: {
        musicxml: "<score />",
        mime_type: "application/vnd.recordare.musicxml+xml",
      },
    },
  });
  openPage();
  await screen.findByText(practice.savedTakeCompositeVideoRevisionUnavailable);
  expect(screen.getByTestId("raw-source")).toBeVisible();
  expect(screen.queryByTestId("score-export")).toBeNull();
});
it("owns one downloaded reference and releases it exactly once on unmount", async () => {
  const remove = vi.fn(async () => {}),
    media = createLocalMediaAsset(blob, remove);
  calls.media.mockResolvedValue(media);
  const view = openPage();
  await screen.findByTestId("raw-source");
  expect(calls.media).toHaveBeenCalledWith(
    expect.objectContaining({
      takeId: take.take_id,
      expectedByteSize: take.manifest.capture.byte_size,
      expectedMimeType: take.manifest.capture.mime_type,
      signal: expect.any(AbortSignal),
    }),
  );
  expect(remove).not.toHaveBeenCalled();
  view.unmount();
  await waitFor(() => expect(remove).toHaveBeenCalledOnce());
});
it("late successful download after route exit retires its handle without publishing", async () => {
  const remove = vi.fn(async () => {}),
    media = createLocalMediaAsset(blob, remove);
  let resolve!: (value: typeof media) => void;
  calls.media.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = openPage();
  await waitFor(() => expect(calls.media).toHaveBeenCalledOnce());
  const signal = calls.media.mock.calls[0][0].signal as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true);
  resolve(media);
  await waitFor(() => expect(remove).toHaveBeenCalledOnce());
  expect(calls.player).not.toHaveBeenCalled();
});
it("failed download retries with a new operation and owns only the successful media", async () => {
  const remove = vi.fn(async () => {}),
    media = createLocalMediaAsset(blob, remove);
  calls.media
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce(media);
  const view = openPage();
  await screen.findByText(practice.savedTakeCompositeVideoTemporaryUnavailable);
  fireEvent.click(
    screen.getByRole("button", { name: practice.savedTakeCompositeVideoRetry }),
  );
  await screen.findByTestId("raw-source");
  expect(calls.media).toHaveBeenCalledTimes(2);
  expect(calls.media.mock.calls[0][0].signal.aborted).toBe(true);
  view.unmount();
  await waitFor(() => expect(remove).toHaveBeenCalledOnce());
});

it("admits a saved AUDIO Take into the same independent Composite input", async () => {
  const original = structuredClone(take);
  try {
    take.manifest.capture.kind = "AUDIO";
    take.manifest.capture.mime_type = "audio/webm";
    take.archive_media.mime_type = "audio/webm";
    const audio = new Blob(["raw audio!"], { type: "audio/webm" });
    calls.media.mockResolvedValueOnce(localMediaAssetFixture(audio));
    const view = openPage();
    await screen.findByTestId("score-export");
    const input = calls.studio.mock.calls.at(-1)![0].input;
    expect(input.recordedPerformance.recording.kind).toBe("AUDIO");
    expect(input.recordedPerformance.recording.media.blob).toBe(audio);
    expect(Object.keys(input).sort()).toEqual([
      "musicXml",
      "recordedPerformance",
    ]);
    expect(calls.player.mock.calls.at(-1)![0].source.kind).toBe("AUDIO");
    view.unmount();
  } finally {
    Object.assign(take, original);
  }
});
