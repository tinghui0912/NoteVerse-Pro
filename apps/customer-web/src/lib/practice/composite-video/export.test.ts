import { recordedPerformanceFixture } from "@/lib/practice/__fixtures__/recorded-performance";
import { continuousPracticePlan } from "@/lib/practice/__fixtures__/practice-plan";
import { artifact as videoArtifact } from "./__fixtures__/saved-take";
// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  composeCompositeVideoOutputStream,
  drawCompositeVideoFrame,
  getCompositeVideoReadiness,
  selectSupportedCompositeVideoMimeType,
} from "./export";
import { resolveCompositeVideoPlaybackPosition } from "./playback-position";
import { renderCompositeVideoFrameAtTime } from "./frame-renderer";
import {
  applyExportPlayheadCursor,
  getPlayheadCursorGeometry,
} from "@/lib/practice/score-view/playhead-cursor";
import {
  getEventScoreImage,
  prepareCompositeScoreModel,
  type ScorePageImageLoader,
  type CompositeScoreModel,
} from "./score-model";
import { getCompositeVideoLayout } from "./templates";
import type { RecordedPerformance } from "@/lib/practice/recording/recorded-performance";

const renderer = vi.hoisted(() => ({
  pages: [] as { pageNumber: number; svg: string }[],
  load: vi.fn(async (_xml: string) => {}),
  dispose: vi.fn(),
}));
vi.mock("@/lib/practice/score-view/verovio-adapter", () => ({
  PracticeVerovioAdapter: class {
    loadMusicXml = renderer.load;
    renderAllPages = () => renderer.pages;
    dispose = renderer.dispose;
  },
}));
const originalAppend = Element.prototype.appendChild;
let latestModel: CompositeScoreModel;
async function prepareRenderedScoreFixture(
  container: HTMLElement,
  loadImage: ScorePageImageLoader,
  options: { eventImageLoader?: ScorePageImageLoader } & {
    eventSvgDecorator?: (svg: SVGSVGElement) => void;
  } = {},
) {
  const svgs = [...container.querySelectorAll<SVGSVGElement>("svg")];
  renderer.pages = svgs.map((svg, index) => ({
    pageNumber: index + 1,
    svg: svg.outerHTML,
  }));
  vi.spyOn(Element.prototype, "appendChild").mockImplementation(function <
    T extends Node,
  >(this: Element, child: T): T {
    const result = originalAppend.call(this, child) as T;
    if (
      this instanceof HTMLElement &&
      (this.dataset.compositeScoreHost || child instanceof SVGSVGElement)
    ) {
      const roots =
        child instanceof SVGSVGElement
          ? [child]
          : child instanceof Element
            ? [...child.querySelectorAll("svg")]
            : [];
      for (const svg of roots) {
        const source =
          svgs.find((candidate) =>
            [...candidate.querySelectorAll("[data-id]")].some((note) =>
              svg.querySelector(`[data-id="${note.getAttribute("data-id")}"]`),
            ),
          ) ?? svgs[0];
        const sources = [source, ...source.querySelectorAll("*")],
          targets = [svg, ...svg.querySelectorAll("*")];
        for (let i = 0; i < targets.length; i++) {
          const from = sources[i] as unknown as Record<string, unknown>,
            to = targets[i] as unknown as Record<string, unknown>;
          if (!from) continue;
          for (const key of [
            "getBBox",
            "getCTM",
            "getScreenCTM",
            "getBoundingClientRect",
            "createSVGPoint",
          ])
            if (Object.hasOwn(from, key)) to[key] = from[key];
        }
        options.eventSvgDecorator?.(svg);
      }
    }
    return result;
  });
  const model = await prepareCompositeScoreModel(
    {
      musicXml: "<canonical-score />",
      artifact: createSession().executed.bundle.artifact,
    },
    loadImage,
  );
  latestModel = model;
  for (const page of model.pages.values())
    page.eventImageLoader =
      options.eventImageLoader ?? (async () => page.image);
  return model.pages;
}

function createSession(
  overrides: Partial<RecordedPerformance> = {},
): RecordedPerformance {
  const artifact = {
    ...videoArtifact,
    notes: videoArtifact.notes.map((note, i) => ({
      ...note,
      renderNoteId: `note-page-${i + 1}`,
    })),
    events: videoArtifact.events.map((event, i) => ({
      ...event,
      onsetTick: i ? 8 : 4,
      durationTicks: i ? 8 : 4,
    })),
    moments: videoArtifact.moments.map((group, i) => ({
      ...group,
      onsetTick: i ? 8 : 4,
      canonicalEndTick: i ? 16 : 8,
    })),
    scoreTempoSegments: [
      { startTick: 0, bpm: 120 },
      { startTick: 8, bpm: 60 },
    ],
  };
  const plan = continuousPracticePlan(artifact, {
    scope: { kind: "RANGE", startGroupId: "group-1", endGroupId: "group-2" },
  });
  const base = recordedPerformanceFixture(plan, {
    ...recordedPerformanceFixture().recording,
    timebase: {
      nominalMediaDurationUs: 6000000,
      activeSegments: [
        {
          performanceStartUs: 0,
          performanceEndUs: 3000000,
          mediaStartUs: 0,
          mediaEndUs: 3000000,
        },
        {
          performanceStartUs: 5000000,
          performanceEndUs: 8000000,
          mediaStartUs: 3000000,
          mediaEndUs: 6000000,
        },
      ],
    },
  });
  return { ...base, ...overrides };
}

function createAdapter() {
  return {
    getCursorTimelineEntryForTickRange: vi.fn(
      (tick: number, startTick: number, terminalTick: number) => {
        if (tick < startTick || tick > terminalTick) return null;
        const noteId = tick >= 8 ? "note-page-2" : "note-page-1";
        return {
          index: 0,
          tick,
          endTick: tick + 1,
          noteIds: [noteId],
        };
      },
    ),
    getPageWithElement: vi.fn((noteId: string) =>
      noteId === "note-page-2" ? 2 : 1,
    ),
  };
}

function makeImage(width = 1200, height = 1600) {
  const image = document.createElement("img");
  Object.defineProperty(image, "naturalWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(image, "naturalHeight", {
    configurable: true,
    value: height,
  });
  return image;
}

type FakeContextCall = { name: string; args: unknown[] };

function createFakeContext() {
  const calls: FakeContextCall[] = [];
  const ctx = {
    calls,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    shadowColor: "",
    shadowBlur: 0,
    beginPath: vi.fn(() => calls.push({ name: "beginPath", args: [] })),
    moveTo: vi.fn((...args: unknown[]) => calls.push({ name: "moveTo", args })),
    lineTo: vi.fn((...args: unknown[]) => calls.push({ name: "lineTo", args })),
    quadraticCurveTo: vi.fn((...args: unknown[]) =>
      calls.push({ name: "quadraticCurveTo", args }),
    ),
    closePath: vi.fn(() => calls.push({ name: "closePath", args: [] })),
    fill: vi.fn(() => calls.push({ name: "fill", args: [] })),
    stroke: vi.fn(() => calls.push({ name: "stroke", args: [] })),
    save: vi.fn(() => calls.push({ name: "save", args: [] })),
    restore: vi.fn(() => calls.push({ name: "restore", args: [] })),
    fillRect: vi.fn((...args: unknown[]) =>
      calls.push({ name: "fillRect", args }),
    ),
    drawImage: vi.fn((...args: unknown[]) =>
      calls.push({ name: "drawImage", args }),
    ),
  };
  return ctx as unknown as CanvasRenderingContext2D & {
    calls: FakeContextCall[];
  };
}

function createScoreContainer() {
  const container = document.createElement("div");
  container.innerHTML = `
    <div data-practice-review-page="1">
      <svg viewBox="0 0 1200 1600" width="1200" height="1600">
        <g class="system" data-testid="system-1">
          <g data-id="note-a"></g>
          <g data-id="note-b"></g>
          <g data-id="chord-1"></g>
        </g>
      </svg>
    </div>
    <div data-practice-review-page="2">
      <svg viewBox="0 0 1200 1600" width="1200" height="1600">
        <g class="system" data-testid="system-2">
          <g data-id="note-page-2"></g>
        </g>
      </svg>
    </div>
  `;
  const boxes: Record<
    string,
    { x: number; y: number; width: number; height: number }
  > = {
    "system-1": { x: 60, y: 120, width: 1080, height: 260 },
    "system-2": { x: 60, y: 430, width: 1080, height: 260 },
    "note-a": { x: 100, y: 200, width: 30, height: 40 },
    "note-b": { x: 180, y: 200, width: 30, height: 40 },
    "chord-1": { x: 260, y: 360, width: 80, height: 50 },
    "note-page-2": { x: 400, y: 500, width: 35, height: 45 },
  };
  container
    .querySelectorAll<SVGGraphicsElement>("[data-id], [data-testid]")
    .forEach((element) => {
      const id =
        element.getAttribute("data-id") ??
        element.getAttribute("data-testid") ??
        "";
      element.getBBox = vi.fn(() => boxes[id] as DOMRect);
    });
  installIdentitySvgGeometry(container);
  document.body.appendChild(container);
  return container;
}

function installIdentitySvgGeometry(container: HTMLElement) {
  const matrix = {
    inverse: vi.fn(() => matrix),
    multiply: vi.fn(() => ({
      transformPoint: (point: { x: number; y: number }) => ({
        x: point.x,
        y: point.y,
      }),
    })),
  };
  container
    .querySelectorAll<SVGGraphicsElement>("svg, g")
    .forEach((element) => {
      element.getCTM = vi.fn(() => matrix as unknown as DOMMatrix);
    });
  container.querySelectorAll<SVGSVGElement>("svg").forEach((svg) => {
    svg.createSVGPoint = vi.fn(
      () =>
        ({
          x: 0,
          y: 0,
          matrixTransform(matrixLike: {
            transformPoint: (point: { x: number; y: number }) => {
              x: number;
              y: number;
            };
          }) {
            return matrixLike.transformPoint(this);
          },
        }) as SVGPoint,
    );
  });
}

describe("Composite Video rendering", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("selects a supported WebM MediaRecorder mime type", () => {
    const FakeMediaRecorder = {
      isTypeSupported: vi.fn(
        (mime: string) => mime === "video/webm;codecs=vp8,opus",
      ),
    };
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);

    expect(selectSupportedCompositeVideoMimeType()).toBe(
      "video/webm;codecs=vp8,opus",
    );
  });

  it("reports unsupported encoding when MediaRecorder cannot encode WebM", () => {
    const FakeMediaRecorder = {
      isTypeSupported: vi.fn(() => false),
    };
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);

    expect(selectSupportedCompositeVideoMimeType()).toBeNull();
  });

  it("checks admitted input and browser encoding capabilities", () => {
    vi.stubGlobal("MediaRecorder", { isTypeSupported: () => true });
    Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
      configurable: true,
      value: vi.fn(),
    });
    expect(getCompositeVideoReadiness(null)).toEqual({
      ok: false,
      reason: "input_unavailable",
    });
    expect(
      getCompositeVideoReadiness({
        recordedPerformance: createSession(),
        musicXml: "<score />",
      }).ok,
    ).toBe(true);
    expect(
      getCompositeVideoReadiness({
        recordedPerformance: createSession(),
        musicXml: "",
      }),
    ).toEqual({ ok: false, reason: "input_unavailable" });
  });

  it("resolves selected-scope timing through pause/resume and variable tempo into score pages", () => {
    const recordedPerformance = createSession();
    const adapter = createAdapter();

    const firstSegment = resolveCompositeVideoPlaybackPosition({
      recordedPerformance,
      adapter,
      mediaTimeMs: 1000,
    });
    expect(firstSegment?.perfTimeMs).toBe(1000);
    expect(firstSegment?.scoreTick).toBe(6);
    expect(firstSegment?.pageNumber).toBe(1);
    expect(firstSegment?.noteIds).toEqual(["note-page-1"]);

    const afterPause = resolveCompositeVideoPlaybackPosition({
      recordedPerformance,
      adapter,
      mediaTimeMs: 4000,
    });
    expect(afterPause?.perfTimeMs).toBe(6000);
    expect(afterPause?.scoreTick).toBe(12);
    expect(afterPause?.pageNumber).toBe(2);
    expect(afterPause?.noteIds).toEqual(["note-page-2"]);
  });

  it("scales media time when decoded media duration differs from nominal duration", () => {
    const recordedPerformance = createSession();
    const adapter = createAdapter();

    const frame = resolveCompositeVideoPlaybackPosition({
      recordedPerformance,
      adapter,
      mediaTimeMs: 5000,
      actualMediaDurationMs: 10000,
    });

    expect(frame?.perfTimeMs).toBe(3000);
    expect(frame?.pageNumber).toBe(2);
  });

  it("combines the canvas video track with original recording audio tracks", () => {
    const canvasVideoTrack = { kind: "video" } as MediaStreamTrack;
    const audioTrack = { kind: "audio" } as MediaStreamTrack;
    const canvasStream = {
      getVideoTracks: () => [canvasVideoTrack],
    } as MediaStream;
    const audioStream = {
      getAudioTracks: () => [audioTrack],
    } as MediaStream;
    const mediaStreamSpy = vi.fn(function FakeMediaStream(
      this: { tracks?: MediaStreamTrack[] },
      tracks?: MediaStreamTrack[],
    ) {
      this.tracks = tracks;
    });
    vi.stubGlobal("MediaStream", mediaStreamSpy);

    const result = composeCompositeVideoOutputStream(
      canvasStream,
      audioStream,
    ) as unknown as {
      tracks: MediaStreamTrack[];
    };

    expect(mediaStreamSpy).toHaveBeenCalledWith([canvasVideoTrack, audioTrack]);
    expect(result.tracks).toEqual([canvasVideoTrack, audioTrack]);
  });

  it("prepares score page images once per page from the Composite renderer", async () => {
    const container = createScoreContainer();
    const loadImage = vi.fn(async (svgText: string) => {
      expect(svgText).not.toContain("practice-note-active");
      return makeImage();
    });

    const cache = await prepareRenderedScoreFixture(container, loadImage);

    expect(cache.size).toBe(2);
    expect(loadImage).toHaveBeenCalledTimes(2);
  });

  it("renders canonical notation without consuming an unrelated annotated Review DOM", async () => {
    const review = createScoreContainer();
    review
      .querySelector('[data-id="note-a"]')!
      .classList.add("practice-summary-note-supported");
    const canonical = createScoreContainer();
    const serialized: string[] = [];
    const cache = await prepareRenderedScoreFixture(canonical, async (text) => {
      serialized.push(text);
      return makeImage();
    });
    expect(renderer.load).toHaveBeenCalledWith("<canonical-score />");
    expect(serialized).toHaveLength(2);
    expect(serialized.join("")).not.toContain(
      "practice-summary-note-supported",
    );
    expect(
      review.querySelector(".practice-summary-note-supported"),
    ).not.toBeNull();
    expect(cache.size).toBe(2);
    expect(document.querySelector("[data-composite-score-host]")).toBeNull();
  });

  it("renders the event cursor inside the frozen SVG image instead of on Canvas", async () => {
    const container = createScoreContainer();
    const serialized: string[] = [];
    const eventImageLoader = vi.fn(async (svgText: string) => {
      serialized.push(svgText);
      return makeImage();
    });
    const matrix = {
      inverse: vi.fn(() => matrix),
      multiply: vi.fn(() => matrix),
    };
    const cache = await prepareRenderedScoreFixture(
      container,
      async (svgText) => {
        serialized.push(svgText);
        return makeImage();
      },
      {
        eventImageLoader,
        eventSvgDecorator: (svg) => {
          svg.createSVGPoint = vi.fn(
            () =>
              ({
                x: 0,
                y: 0,
                matrixTransform(pointMatrix: {
                  transformPoint?: (point: unknown) => unknown;
                }) {
                  return pointMatrix.transformPoint?.(this) ?? this;
                },
              }) as SVGPoint,
          );
          svg.getCTM = vi.fn(() => matrix as unknown as DOMMatrix);
          svg.querySelectorAll<SVGGraphicsElement>("g").forEach((element) => {
            const id = element.getAttribute("data-id");
            if (id === "note-a") {
              element.getBBox = vi.fn(
                () =>
                  ({
                    x: 100,
                    y: 200,
                    width: 30,
                    height: 40,
                  }) as DOMRect,
              );
              element.getCTM = vi.fn(() => matrix as unknown as DOMMatrix);
            }
          });
        },
      },
    );

    const image = await getEventScoreImage(cache.get(1)!, ["note-a"]);
    const cachedImage = await getEventScoreImage(cache.get(1)!, ["note-a"]);

    expect(image).toBeTruthy();
    expect(cachedImage).toBe(image);
    expect(eventImageLoader).toHaveBeenCalledTimes(1);
    expect(
      serialized.filter((text) =>
        text.includes("data-practice-playhead-cursor"),
      ),
    ).toHaveLength(1);
    expect(serialized.at(-1)).toContain("data-practice-playhead-cursor");
  });

  it("renders one colored cursor per active staff without spanning the grand staff", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <svg viewBox="0 0 800 900" width="800" height="900">
        <g class="system">
          <g class="staff" data-id="staff-top">
            <g data-id="top-a"></g>
            <g data-id="top-b"></g>
          </g>
          <g class="staff" data-id="staff-bottom">
            <g data-id="bottom-a"></g>
          </g>
        </g>
      </svg>
    `;
    const boxes: Record<
      string,
      { x: number; y: number; width: number; height: number }
    > = {
      "staff-top": { x: 80, y: 120, width: 640, height: 100 },
      "staff-bottom": { x: 80, y: 520, width: 640, height: 100 },
      "top-a": { x: 240, y: 150, width: 24, height: 32 },
      "top-b": { x: 246, y: 150, width: 28, height: 32 },
      "bottom-a": { x: 240, y: 550, width: 24, height: 32 },
    };
    const svg = container.querySelector<SVGSVGElement>("svg")!;
    const system = container.querySelector<SVGGraphicsElement>(".system")!;
    const identity = {
      inverse: vi.fn(() => identity),
      multiply: vi.fn(() => identity),
    };
    container
      .querySelectorAll<SVGGraphicsElement>("[data-id]")
      .forEach((element) => {
        element.getBBox = vi.fn(
          () => boxes[element.getAttribute("data-id")!] as DOMRect,
        );
        element.getCTM = vi.fn(() => identity as unknown as DOMMatrix);
      });
    system.getBBox = vi.fn(
      () => ({ x: 80, y: 120, width: 640, height: 500 }) as DOMRect,
    );
    system.getCTM = vi.fn(() => identity as unknown as DOMMatrix);
    svg.createSVGPoint = vi.fn(
      () =>
        ({
          x: 0,
          y: 0,
          matrixTransform: (point: { x: number; y: number }) => point,
        }) as SVGPoint,
    );
    document.body.appendChild(container);

    const result = applyExportPlayheadCursor(
      container,
      ["top-a", "top-b", "bottom-a"],
      "top-a",
    );
    const cursor = container.querySelector<SVGRectElement>(
      "[data-practice-playhead-cursor]",
    );

    expect(result.geometry).not.toBeNull();
    expect(cursor).not.toBeNull();
    const cursors = container.querySelectorAll<SVGRectElement>(
      "[data-practice-playhead-cursor]",
    );
    expect(cursors).toHaveLength(2);
    expect(
      Array.from(cursors).map((cursor) =>
        cursor.getAttribute("data-playhead-staff"),
      ),
    ).toEqual(expect.arrayContaining(["treble", "bass"]));
    const trebleCursor = container.querySelector<SVGRectElement>(
      '[data-practice-playhead-cursor][data-playhead-staff="treble"]',
    );
    const bassCursor = container.querySelector<SVGRectElement>(
      '[data-practice-playhead-cursor][data-playhead-staff="bass"]',
    );
    expect(trebleCursor?.getAttribute("fill")).toEqual(
      expect.stringContaining("125, 211, 252"),
    );
    expect(bassCursor?.getAttribute("fill")).toEqual(
      expect.stringContaining("251, 191, 36"),
    );
    expect(Number(trebleCursor?.getAttribute("y"))).toBeLessThan(120);
    expect(
      Number(trebleCursor?.getAttribute("y")) +
        Number(trebleCursor?.getAttribute("height")),
    ).toBeLessThan(300);
  });

  it("keeps staff colors stable when a system contains repeated measure staff pairs", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <svg viewBox="0 0 800 900" width="800" height="900">
        <g class="system" data-id="system-1">
          <g class="measure" data-id="measure-1">
            <g class="staff" data-id="measure-1-top"><g data-id="measure-1-top-note"></g></g>
            <g class="staff" data-id="measure-1-bottom"><g data-id="measure-1-bottom-note"></g></g>
          </g>
          <g class="measure" data-id="measure-2">
            <g class="staff" data-id="measure-2-top"><g data-id="measure-2-top-note"></g></g>
            <g class="staff" data-id="measure-2-bottom"><g data-id="measure-2-bottom-note"></g></g>
          </g>
        </g>
      </svg>
    `;
    const boxes: Record<
      string,
      { x: number; y: number; width: number; height: number }
    > = {
      "measure-1-top": { x: 80, y: 100, width: 300, height: 100 },
      "measure-1-bottom": { x: 80, y: 300, width: 300, height: 100 },
      "measure-2-top": { x: 420, y: 100, width: 300, height: 100 },
      "measure-2-bottom": { x: 420, y: 300, width: 300, height: 100 },
      "measure-2-top-note": { x: 520, y: 120, width: 24, height: 32 },
      "measure-2-bottom-note": { x: 520, y: 320, width: 24, height: 32 },
    };
    const containerSvg = container.querySelector<SVGSVGElement>("svg")!;
    const system = container.querySelector<SVGGraphicsElement>(".system")!;
    const identity = {
      inverse: vi.fn(() => identity),
      multiply: vi.fn(() => identity),
    };
    container
      .querySelectorAll<SVGGraphicsElement>("[data-id]")
      .forEach((element) => {
        element.getBBox = vi.fn(
          () =>
            (boxes[element.getAttribute("data-id")!] ?? {
              x: 0,
              y: 0,
              width: 1,
              height: 1,
            }) as DOMRect,
        );
        element.getCTM = vi.fn(() => identity as unknown as DOMMatrix);
      });
    system.getBBox = vi.fn(
      () => ({ x: 80, y: 100, width: 640, height: 300 }) as DOMRect,
    );
    system.getCTM = vi.fn(() => identity as unknown as DOMMatrix);
    containerSvg.createSVGPoint = vi.fn(
      () =>
        ({
          x: 0,
          y: 0,
          matrixTransform: (point: { x: number; y: number }) => point,
        }) as SVGPoint,
    );
    document.body.appendChild(container);

    applyExportPlayheadCursor(
      container,
      ["measure-2-top-note", "measure-2-bottom-note"],
      "measure-2-top-note",
    );

    expect(
      container.querySelector(
        '[data-practice-playhead-cursor][data-playhead-staff="treble"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-practice-playhead-cursor][data-playhead-staff="bass"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelectorAll('[data-playhead-staff="other"]'),
    ).toHaveLength(0);
  });

  it("advances five notes on the same page without decoding page images again", async () => {
    const container = createScoreContainer();
    const loadImage = vi.fn(async () => makeImage());
    const cache = await prepareRenderedScoreFixture(container, loadImage);
    const finalCtx = createFakeContext();
    const stagingCtx = createFakeContext();
    const stagingCanvas = document.createElement("canvas");
    const video = document.createElement("video");
    Object.defineProperty(video, "videoWidth", {
      configurable: true,
      value: 640,
    });
    Object.defineProperty(video, "videoHeight", {
      configurable: true,
      value: 480,
    });

    const adapter = {
      getCursorTimelineEntryForTickRange: vi.fn((tick: number) => ({
        index: 0,
        tick,
        endTick: tick + 1,
        noteIds: [tick % 2 === 0 ? "note-a" : "note-b"],
      })),
      getPageWithElement: vi.fn(() => 1),
    };
    const recordedPerformance = recordedPerformanceFixture(
      continuousPracticePlan(videoArtifact, {
        tempoSelection: { mode: "CUSTOM_FIXED_BPM", bpm: 60 },
      }),
      {
        ...recordedPerformanceFixture().recording,
        timebase: {
          nominalMediaDurationUs: 5000000,
          activeSegments: [
            {
              performanceStartUs: 0,
              performanceEndUs: 5000000,
              mediaStartUs: 0,
              mediaEndUs: 5000000,
            },
          ],
        },
      },
    );

    for (let i = 0; i < 5; i += 1) {
      Object.defineProperty(video, "currentTime", {
        configurable: true,
        value: i,
      });
      await drawCompositeVideoFrame({
        ctx: finalCtx,
        mediaElement: video,
        recordedPerformance,

        frameState: {
          scoreModel: { pages: cache, adapter: adapter as never, dispose() {} },
          stagingCanvas,
          stagingCtx,
          sourceFrame: createSourceFrame(),
        },
      });
    }

    expect(loadImage).toHaveBeenCalledTimes(2);
    expect(finalCtx.drawImage).toHaveBeenCalledTimes(5);
  });

  it("commits only complete staged frames to the captured canvas", async () => {
    const container = createScoreContainer();
    const cache = await prepareRenderedScoreFixture(container, async () =>
      makeImage(),
    );
    const finalCtx = createFakeContext();
    const stagingCtx = createFakeContext();
    const stagingCanvas = document.createElement("canvas");
    const video = document.createElement("video");
    Object.defineProperty(video, "videoWidth", {
      configurable: true,
      value: 640,
    });
    Object.defineProperty(video, "videoHeight", {
      configurable: true,
      value: 480,
    });
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      value: 1,
    });
    const adapter = {
      getCursorTimelineEntryForTickRange: vi.fn((tick: number) => ({
        index: 0,
        tick,
        endTick: tick + 1,
        noteIds: ["note-a"],
      })),
      getPageWithElement: vi.fn(() => 1),
    };

    await drawCompositeVideoFrame({
      ctx: finalCtx,
      mediaElement: video,
      recordedPerformance: createSession(),

      frameState: {
        scoreModel: { pages: cache, adapter: adapter as never, dispose() {} },
        stagingCanvas,
        stagingCtx,
        sourceFrame: createSourceFrame(),
      },
    });

    const stagingCallNames = stagingCtx.calls.map((call) => call.name);
    expect(stagingCallNames).toContain("fillRect");
    expect(stagingCallNames).toContain("drawImage");
    expect(
      stagingCallNames.filter((name) => name === "drawImage"),
    ).toHaveLength(2);
    expect(finalCtx.calls).toEqual([
      { name: "drawImage", args: [stagingCanvas, 0, 0] },
    ]);
  });

  it("keeps independent geometry stable when unrelated score DOM changes", async () => {
    const container = createScoreContainer();
    const loadImage = vi.fn(async () => makeImage());
    const cache = await prepareRenderedScoreFixture(container, loadImage);
    const finalCtx = createFakeContext();
    const stagingCtx = createFakeContext();
    const stagingCanvas = document.createElement("canvas");
    const video = document.createElement("video");
    Object.defineProperty(video, "videoWidth", {
      configurable: true,
      value: 640,
    });
    Object.defineProperty(video, "videoHeight", {
      configurable: true,
      value: 480,
    });
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      value: 1,
    });
    const adapter = {
      getCursorTimelineEntryForTickRange: vi.fn(() => ({
        index: 0,
        tick: 4,
        endTick: 5,
        noteIds: ["note-a"],
      })),
      getPageWithElement: vi.fn(() => 1),
    };
    const frameState = {
      scoreModel: { pages: cache, adapter: adapter as never, dispose() {} },
      stagingCanvas,
      stagingCtx,
      sourceFrame: createSourceFrame(),
    };

    await drawCompositeVideoFrame({
      ctx: finalCtx,
      mediaElement: video,
      recordedPerformance: createSession(),

      frameState,
    });

    const replacement = createScoreContainer();
    container.replaceWith(replacement);

    await expect(
      drawCompositeVideoFrame({
        ctx: finalCtx,
        mediaElement: video,
        recordedPerformance: createSession(),

        frameState,
      }),
    ).resolves.toBeUndefined();
    expect(loadImage).toHaveBeenCalledTimes(2);
    expect(
      finalCtx.calls.filter((call) => call.name === "drawImage"),
    ).toHaveLength(2);
    expect(cache.get(1)?.geometryByNoteId.has("note-a")).toBe(true);
    expect(adapter.getPageWithElement).not.toHaveBeenCalled();
  });

  it("uses real note geometry for one background playhead cursor", () => {
    const container = createScoreContainer();
    const svg = container.querySelector<SVGSVGElement>("svg")!;

    const geometry = getPlayheadCursorGeometry(svg, ["note-a", "chord-1"]);

    expect(geometry?.noteBox).toEqual({
      x: 100,
      y: 200,
      width: 240,
      height: 210,
    });
    expect(geometry?.systemBox).toEqual({
      x: 60,
      y: 120,
      width: 1080,
      height: 260,
    });
    expect(geometry?.box.height).toBeGreaterThan(260);
    expect(geometry?.box.x).toBeLessThan(geometry!.noteBox.x);
    expect(geometry?.box.width).toBeGreaterThan(geometry!.noteBox.width);
  });

  it("renders a deterministic static frame from the frozen score model", async () => {
    const container = createScoreContainer();
    const cache = await prepareRenderedScoreFixture(container, async () =>
      makeImage(),
    );
    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = 1280;
    outputCanvas.height = 720;
    const ctx = createFakeContext();
    Object.defineProperty(outputCanvas, "getContext", {
      configurable: true,
      value: () => ctx,
    });
    const diagnostics = await renderCompositeVideoFrameAtTime({
      mediaTimeMs: 1000,
      scoreModel: cache,
      playbackTimeline: {
        resolve: () => ({
          perfTimeMs: 1000,
          scoreTick: 4,
          pageNumber: 1,
          noteIds: ["note-a"],
        }),
      },
      sourceVideoFrame: {
        width: 640,
        height: 480,
      } as unknown as CanvasImageSource,
      outputCanvas,
      layout: {
        kind: "SCORE_AND_VIDEO",
        width: 1280,
        height: 720,
        scoreBackground: "#ffffff",
        scoreRect: { x: 24, y: 24, width: 704, height: 672 },
        videoRect: { x: 752, y: 24, width: 504, height: 672 },
        background: "#0f172a",
      },
    });

    expect(diagnostics.anchorNoteId).toBe("note-a");
    expect(diagnostics.systemId).toBeTruthy();
    expect(diagnostics.cursorBox.height).toBeGreaterThan(0);
    expect(ctx.drawImage).toHaveBeenCalled();
  });

  it("keeps transformed system-local and root SVG cursor rectangles in separate coordinate spaces", () => {
    const container = createScoreContainer();
    const svg = container.querySelector<SVGSVGElement>("svg")!;
    const system = container.querySelector<SVGGraphicsElement>(
      '[data-testid="system-1"]',
    )!;
    const systemMatrix = {};
    const rootMatrix = {
      inverse: vi.fn(() => rootInverse),
    };
    const rootInverse = {
      multiply: vi.fn(() => ({
        transformPoint: (point: { x: number; y: number }) => ({
          x: point.x + 500,
          y: point.y + 900,
        }),
      })),
    };
    const point = {
      x: 0,
      y: 0,
      matrixTransform(matrix: {
        transformPoint: (point: { x: number; y: number }) => {
          x: number;
          y: number;
        };
      }) {
        return matrix.transformPoint(this);
      },
    };
    svg.createSVGPoint = vi.fn(() => ({ ...point }) as SVGPoint);
    svg.getCTM = vi.fn(() => rootMatrix as unknown as DOMMatrix);
    system.getCTM = vi.fn(() => systemMatrix as unknown as DOMMatrix);

    const geometry = getPlayheadCursorGeometry(svg, ["note-a"]);

    expect(geometry?.box.x).toBeLessThan(200);
    expect(geometry?.rootBox?.x).toBeGreaterThan(500);
    expect(geometry?.rootSystemBox?.y).toBeGreaterThan(900);
  });

  it("fails coordinate conversion instead of exporting with system-local rectangles as root coordinates", async () => {
    const container = createScoreContainer();
    container
      .querySelectorAll<SVGGraphicsElement>("svg, g")
      .forEach((element) => {
        element.getCTM = undefined as unknown as SVGGraphicsElement["getCTM"];
      });
    const cache = await prepareRenderedScoreFixture(container, async () =>
      makeImage(),
    );
    const finalCtx = createFakeContext();
    const stagingCtx = createFakeContext();
    const stagingCanvas = document.createElement("canvas");
    const video = document.createElement("video");
    Object.defineProperty(video, "videoWidth", {
      configurable: true,
      value: 640,
    });
    Object.defineProperty(video, "videoHeight", {
      configurable: true,
      value: 480,
    });
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      value: 1,
    });
    const adapter = {
      getCursorTimelineEntryForTickRange: vi.fn((tick: number) => ({
        index: 0,
        tick,
        endTick: tick + 1,
        noteIds: ["note-a"],
      })),
      getPageWithElement: vi.fn(() => 1),
    };

    await expect(
      drawCompositeVideoFrame({
        ctx: finalCtx,
        mediaElement: video,
        recordedPerformance: createSession(),

        frameState: {
          scoreModel: { pages: cache, adapter: adapter as never, dispose() {} },
          stagingCanvas,
          stagingCtx,
          sourceFrame: createSourceFrame(),
        },
      }),
    ).rejects.toThrow(
      "composite_video_failed:playback_event_geometry_unavailable",
    );
  });

  it("uses rendered SVG rectangles to keep visibly present transformed notes inside the export viewport", async () => {
    const container = createScoreContainer();
    const svg = container.querySelector<SVGSVGElement>("svg")!;
    const system = container.querySelector<SVGGraphicsElement>(
      '[data-testid="system-1"]',
    )!;
    const note =
      container.querySelector<SVGGraphicsElement>('[data-id="note-a"]')!;
    svg.getBoundingClientRect = vi.fn(
      () =>
        ({
          left: 0,
          top: 0,
          width: 600,
          height: 800,
          right: 600,
          bottom: 800,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
    );
    system.getBoundingClientRect = vi.fn(
      () =>
        ({
          left: 30,
          top: 80,
          width: 540,
          height: 150,
          right: 570,
          bottom: 230,
          x: 30,
          y: 80,
          toJSON: () => ({}),
        }) as DOMRect,
    );
    note.getBoundingClientRect = vi.fn(
      () =>
        ({
          left: 75,
          top: 120,
          width: 28,
          height: 32,
          right: 103,
          bottom: 152,
          x: 75,
          y: 120,
          toJSON: () => ({}),
        }) as DOMRect,
    );
    svg.getCTM = vi.fn(() => null);
    system.getCTM = vi.fn(() => null);
    note.getCTM = vi.fn(() => null);

    const cache = await prepareRenderedScoreFixture(container, async () =>
      makeImage(),
    );
    const finalCtx = createFakeContext();
    const stagingCtx = createFakeContext();
    const stagingCanvas = document.createElement("canvas");
    const video = document.createElement("video");
    Object.defineProperty(video, "videoWidth", {
      configurable: true,
      value: 640,
    });
    Object.defineProperty(video, "videoHeight", {
      configurable: true,
      value: 480,
    });
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      value: 1,
    });

    await expect(
      drawCompositeVideoFrame({
        ctx: finalCtx,
        mediaElement: video,
        recordedPerformance: createSession(),

        frameState: {
          scoreModel: {
            pages: cache,
            adapter: {
              getCursorTimelineEntryForTickRange: vi.fn((tick: number) => ({
                index: 0,
                tick,
                endTick: tick + 1,
                noteIds: ["note-a"],
              })),
              getPageWithElement: vi.fn(() => 1),
            } as never,
            dispose() {},
          },
          stagingCanvas,
          stagingCtx,
          sourceFrame: createSourceFrame(),
        },
      }),
    ).resolves.toBeUndefined();
  });

  it("maps Verovio internal coordinates through CTM viewport pixels before comparing with the root viewBox", async () => {
    const container = createScoreContainer();
    const svg = container.querySelector<SVGSVGElement>("svg")!;
    const system = container.querySelector<SVGGraphicsElement>(
      '[data-testid="system-1"]',
    )!;
    const note =
      container.querySelector<SVGGraphicsElement>('[data-id="note-a"]')!;
    svg.setAttribute("viewBox", "0 0 840 931");
    svg.setAttribute("width", "840px");
    svg.setAttribute("height", "931px");
    Object.defineProperty(svg, "getBoundingClientRect", {
      configurable: true,
      value: vi.fn(
        () =>
          ({
            left: 0,
            top: 0,
            width: 840 * 0.053047619047619045,
            height: 931 * 0.053047619047619045,
          }) as DOMRect,
      ),
    });
    note.getBBox = vi.fn(
      () =>
        ({
          x: 5039,
          y: 1536.239990234375,
          width: 226.080078125,
          height: 842.760009765625,
        }) as DOMRect,
    );
    system.getBBox = vi.fn(
      () =>
        ({
          x: 182.479736328125,
          y: 1266.239990234375,
          width: 19819.51953125,
          height: 3425.760009765625,
        }) as DOMRect,
    );
    note.getBoundingClientRect = vi.fn(
      () => ({ left: 272, top: 157, width: 12, height: 45 }) as DOMRect,
    );
    system.getBoundingClientRect = vi.fn(
      () => ({ left: 10, top: 140, width: 820, height: 185 }) as DOMRect,
    );
    const matrix = {
      a: 0.053047619047619045,
      b: 0,
      c: 0,
      d: 0.053047619047619045,
      e: 26.523809523809522,
      f: 74.66141915457588,
      inverse: vi.fn(() => matrix),
      multiply: vi.fn(() => matrix),
      transformPoint: (point: { x: number; y: number }) => ({
        x: matrix.a * point.x + matrix.c * point.y + matrix.e,
        y: matrix.b * point.x + matrix.d * point.y + matrix.f,
      }),
    };
    note.getCTM = vi.fn(() => matrix as unknown as DOMMatrix);
    system.getCTM = vi.fn(() => matrix as unknown as DOMMatrix);

    const geometry = getPlayheadCursorGeometry(svg, ["note-a"]);

    expect(geometry?.rootCoordinateSource).toBe("ctm_svg_viewport");
    expect(geometry?.rootNoteBox?.x).toBeGreaterThan(250);
    expect(geometry?.rootNoteBox?.x).toBeLessThan(360);
    expect(geometry?.rootNoteBox?.y).toBeGreaterThan(140);
    expect(geometry?.rootNoteBox?.y).toBeLessThan(230);

    const cache = await prepareRenderedScoreFixture(container, async () =>
      makeImage(840, 931),
    );
    const finalCtx = createFakeContext();
    const stagingCtx = createFakeContext();
    const stagingCanvas = document.createElement("canvas");
    const video = document.createElement("video");
    Object.defineProperty(video, "videoWidth", {
      configurable: true,
      value: 640,
    });
    Object.defineProperty(video, "videoHeight", {
      configurable: true,
      value: 480,
    });
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      value: 1,
    });

    await expect(
      drawCompositeVideoFrame({
        ctx: finalCtx,
        mediaElement: video,
        recordedPerformance: createSession(),

        frameState: {
          scoreModel: {
            pages: cache,
            adapter: {
              getCursorTimelineEntryForTickRange: vi.fn((tick: number) => ({
                index: 0,
                tick,
                endTick: tick + 1,
                noteIds: ["note-a"],
              })),
              getPageWithElement: vi.fn(() => 1),
            } as never,
            dispose() {},
          },
          stagingCanvas,
          stagingCtx,
          sourceFrame: createSourceFrame(),
        },
      }),
    ).resolves.toBeUndefined();
  });
});

it("retires operation-owned geometry and event images idempotently", async () => {
  const container = createScoreContainer();
  const cache = await prepareRenderedScoreFixture(container, async () =>
    makeImage(),
  );
  cache.get(1)!.eventImages.set("test", makeImage());
  const before = renderer.dispose.mock.calls.length;
  latestModel.dispose();
  latestModel.dispose();
  expect(cache.size).toBe(0);
  expect(renderer.dispose.mock.calls.length).toBe(before + 1);
  expect(document.querySelector("[data-composite-score-host]")).toBeNull();
});
it("cancels score preparation before publication and disposes its renderer", async () => {
  const cancel = new AbortController();
  cancel.abort();
  const before = renderer.dispose.mock.calls.length;
  await expect(
    prepareCompositeScoreModel({
      musicXml: "<score />",
      artifact: createSession().executed.bundle.artifact,
      signal: cancel.signal,
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(renderer.dispose.mock.calls.length).toBe(before + 1);
  expect(document.querySelector("[data-composite-score-host]")).toBeNull();
});

it.each([
  ["VIDEO", undefined, "source_video_required"],
  ["AUDIO", { width: 640, height: 480 }, "unexpected_video_frame"],
] as const)(
  "rejects an invalid %s layout/source-frame pairing",
  async (kind, frame, error) => {
    const cache = await prepareRenderedScoreFixture(
      createScoreContainer(),
      async () => makeImage(),
    );
    const canvas = document.createElement("canvas");
    await expect(
      renderCompositeVideoFrameAtTime({
        mediaTimeMs: 0,
        scoreModel: cache,
        playbackTimeline: {
          resolve: () => ({
            perfTimeMs: 0,
            scoreTick: 0,
            pageNumber: 1,
            noteIds: ["note-a"],
          }),
        },
        sourceVideoFrame: frame as CanvasImageSource | undefined,
        outputCanvas: canvas,
        context: createFakeContext() as unknown as CanvasRenderingContext2D,
        layout: getCompositeVideoLayout({ orientation: "landscape" }, kind),
      }),
    ).rejects.toThrow(error);
    latestModel.dispose();
  },
);

function createSourceFrame(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "getContext", {
    configurable: true,
    value: () => createFakeContext(),
  });
  return canvas;
}

it("freezes VIDEO pixels and their media time before asynchronous score rendering", async () => {
  vi.restoreAllMocks();
  const video = document.createElement("video");
  Object.defineProperties(video, {
    videoWidth: { value: 640 },
    videoHeight: { value: 480 },
  });
  video.currentTime = 1;
  const sourceFrame = createSourceFrame();
  const sourceContext = sourceFrame.getContext("2d")!;
  Object.defineProperty(sourceFrame, "getContext", {
    configurable: true,
    value: () => sourceContext,
  });
  const frames = await import("./frame-renderer");
  const render = vi
    .spyOn(frames, "renderCompositeVideoFrameAtTime")
    .mockImplementation(async (options) => {
      expect(sourceContext.drawImage).toHaveBeenCalledWith(video, 0, 0);
      video.currentTime = 2;
      await Promise.resolve();
      expect(options.mediaTimeMs).toBe(1000);
      expect(options.sourceVideoFrame).toBe(sourceFrame);
      return {} as never;
    });
  const ctx = createFakeContext();
  await drawCompositeVideoFrame({
    ctx: ctx as unknown as CanvasRenderingContext2D,
    mediaElement: video,
    recordedPerformance: createSession(),
    frameState: {
      scoreModel: { pages: new Map(), adapter: {} as never, dispose() {} },
      stagingCanvas: document.createElement("canvas"),
      stagingCtx: createFakeContext(),
      sourceFrame,
    },
  });
  expect(render).toHaveBeenCalledOnce();
  render.mockRestore();
});
