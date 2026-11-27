// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import englishPractice from "@/../messages/en/practice.json";
import chinesePractice from "@/../messages/zh/practice.json";
import { recordedPerformanceFixture } from "@/lib/practice/__fixtures__/recorded-performance";
import { createLocalMediaAsset } from "@/lib/practice/media/local-media-asset";
import { RecordingPlaybackPlayer } from "@/components/practice/recording-playback-player";
import { recordingPlaybackSource } from "@/lib/practice/recording/recording-playback";
import { compositeVideoInput } from "./input";
import { CompositeVideoPreview } from "./preview";
const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  render: vi.fn(async (_options: unknown) => {}),
  dispose: vi.fn(),
}));
vi.mock("./score-model", () => ({
  prepareCompositeScoreModel: mocks.prepare,
  findStablePageNumber: () => 1,
}));
vi.mock("./frame-renderer", () => ({
  renderCompositeVideoFrameAtTime: mocks.render,
}));
let paused: WeakMap<HTMLMediaElement, boolean>;
const config = { orientation: "landscape" } as const;
beforeEach(() => {
  vi.clearAllMocks();
  paused = new WeakMap();
  mocks.prepare.mockResolvedValue({
    pages: new Map(),
    adapter: {},
    dispose: mocks.dispose,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
    configurable: true,
    get: () => 2,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "duration", {
    configurable: true,
    get: () => 4,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "paused", {
    configurable: true,
    get() {
      return paused.get(this) ?? true;
    },
  });
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
    configurable: true,
    get: () => 640,
  });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", {
    configurable: true,
    get: () => 480,
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(
    async function (this: HTMLMediaElement) {
      paused.set(this, false);
      this.dispatchEvent(new Event("play"));
    },
  );
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    const was = paused.get(this);
    paused.set(this, true);
    if (was === false) this.dispatchEvent(new Event("pause"));
  });
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as never);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  URL.createObjectURL = vi.fn(() => `blob:decoder-${Math.random()}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function fixture(kind: "AUDIO" | "VIDEO") {
  const removed = vi.fn(async () => {}),
    media = createLocalMediaAsset(
      new Blob(["original"], {
        type: kind === "AUDIO" ? "audio/webm" : "video/webm",
      }),
      removed,
    );
  const retain = vi.fn(() => media.retain());
  const owned = { ...media, retain };
  const base = recordedPerformanceFixture();
  const input = compositeVideoInput(
    {
      ...base,
      recording: {
        ...base.recording,
        kind,
        mimeType: media.blob.type,
        media: owned,
      },
    },
    "<canonical-score />",
  );
  return { input, media, removed, retain };
}
function provider(
  children: React.ReactNode,
  locale = "en",
  messages = englishPractice,
) {
  return (
    <NextIntlClientProvider locale={locale} messages={{ practice: messages }}>
      {children}
    </NextIntlClientProvider>
  );
}
it.each(["AUDIO", "VIDEO"] as const)(
  "%s owns an initially paused decoder and one source lease with exact teardown",
  async (kind) => {
    const f = fixture(kind),
      retain = f.retain;
    const view = render(
      provider(<CompositeVideoPreview input={f.input} config={config} />),
    );
    await screen.findByRole("button", { name: "Play" });
    await waitFor(() =>
      expect(screen.getByTestId("composite-preview-play")).toBeEnabled(),
    );
    const element = view.container.querySelector<HTMLMediaElement>(
      "[data-composite-decoder]",
    )!;
    expect(element.tagName).toBe(kind === "AUDIO" ? "AUDIO" : "VIDEO");
    expect(element.paused).toBe(true);
    expect(retain).toHaveBeenCalledOnce();
    expect(mocks.prepare).toHaveBeenCalledWith({
      musicXml: f.input.musicXml,
      artifact: f.input.recordedPerformance.executed.bundle.artifact,
      signal: expect.any(AbortSignal),
    });
    const frame = mocks.render.mock.calls.at(-1)![0] as {
      sourceVideoFrame?: HTMLCanvasElement;
      layout: { kind: string };
    };
    expect(frame.layout.kind).toBe(
      kind === "AUDIO" ? "SCORE_ONLY" : "SCORE_AND_VIDEO",
    );
    expect(frame.sourceVideoFrame).toEqual(
      kind === "AUDIO" ? undefined : expect.any(HTMLCanvasElement),
    );
    const url = element.src;
    await f.media.release();
    expect(f.removed).not.toHaveBeenCalled();
    view.unmount();
    await waitFor(() => expect(f.removed).toHaveBeenCalledOnce());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
    expect(mocks.dispose).toHaveBeenCalledOnce();
  },
);
it.each(["AUDIO", "VIDEO"] as const)(
  "%s preview and original RecordingPlayback play/seek independently",
  async (kind) => {
    const f = fixture(kind);
    const view = render(
      provider(
        <>
          <RecordingPlaybackPlayer
            source={
              recordingPlaybackSource(f.input.recordedPerformance.recording)!
            }
          />
          <CompositeVideoPreview input={f.input} config={config} />
        </>,
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId("composite-preview-play")).toBeEnabled(),
    );
    const composite = view.container.querySelector<HTMLMediaElement>(
      "[data-composite-decoder]",
    )!;
    const raw = [
      ...view.container.querySelectorAll<HTMLMediaElement>("audio,video"),
    ].find((element) => element !== composite)!;
    expect(raw).toBeDefined();
    expect(raw).not.toBe(composite);
    expect(raw.src).not.toBe(composite.src);
    await act(async () => {
      raw.currentTime = 2;
      await raw.play();
    });
    expect(composite.currentTime).toBe(0);
    expect(composite.paused).toBe(true);
    fireEvent.change(
      screen.getByRole("slider", {
        name: englishPractice.compositeVideoPreviewSeek,
      }),
      { target: { value: "1000" } },
    );
    await act(async () => {
      composite.dispatchEvent(new Event("seeked"));
    });
    expect(composite.currentTime).toBe(1);
    expect(raw.currentTime).toBe(2);
    fireEvent.click(screen.getByTestId("composite-preview-play"));
    await waitFor(() => expect(composite.paused).toBe(false));
    expect(raw.currentTime).toBe(2);
    expect(mocks.render).toHaveBeenLastCalledWith(
      expect.objectContaining({ mediaTimeMs: 1000 }),
    );
    view.unmount();
    await f.media.release();
    expect(f.removed).toHaveBeenCalledOnce();
  },
);
it.each([
  ["en", englishPractice],
  ["zh", chinesePractice],
] as const)("uses %s controls", async (locale, messages) => {
  const f = fixture("AUDIO");
  const view = render(
    provider(
      <CompositeVideoPreview input={f.input} config={config} />,
      locale,
      messages,
    ),
  );
  await waitFor(() =>
    expect(screen.getByTestId("composite-preview-play")).toBeEnabled(),
  );
  expect(
    screen.getByRole("slider", { name: messages.compositeVideoPreviewSeek }),
  ).toBeDefined();
  expect(
    screen.getByLabelText(messages.compositeVideoPreviewCanvasLabel),
  ).toBeDefined();
  view.unmount();
  await f.media.release();
});
it("does not publish a stale frame after a new seek and disposes pending preparation on unmount", async () => {
  const f = fixture("VIDEO");
  let finish!: () => void;
  mocks.render.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(
    provider(<CompositeVideoPreview input={f.input} config={config} />),
  );
  await waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
  view.unmount();
  await act(async () => finish());
  await f.media.release();
  expect(f.removed).toHaveBeenCalledOnce();
  expect(mocks.dispose).toHaveBeenCalledOnce();
});
it("surfaces score preparation failure without falling back to external score DOM", async () => {
  const f = fixture("AUDIO");
  mocks.prepare.mockRejectedValueOnce(new Error("score failed"));
  const view = render(
    provider(<CompositeVideoPreview input={f.input} config={config} />),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("score failed");
  view.unmount();
  await f.media.release();
  expect(f.removed).toHaveBeenCalledOnce();
});
