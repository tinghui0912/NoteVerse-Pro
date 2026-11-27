import { SCORE_DECORATIONS } from "@/lib/practice/score-view/decorations";
import {
  applyPlayheadCursor,
  rootSvgRectForElement,
  snapshotPlayheadCursorGeometry,
  type SvgRect,
} from "@/lib/practice/score-view/playhead-cursor";
import { PracticeVerovioAdapter } from "@/lib/practice/score-view/verovio-adapter";
import type { PracticeScoreArtifact } from "@/lib/practice/score/artifact";

export type SvgViewBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type ScorePageImageLoader = (
  svgText: string,
  signal?: AbortSignal,
) => Promise<HTMLImageElement>;

type ExportScoreSystem = {
  systemId: string;
  pageNumber: number;
  order: number;
  bounds: SvgRect;
  contentBounds: SvgRect;
  viewport: SvgRect;
  staffBoundsById: Map<string, SvgRect>;
  measureIds: string[];
};

type ExportNoteGeometry = {
  pageNumber: number;
  noteId: string;
  noteBox: SvgRect;
  staffBox: SvgRect;
  systemBox: SvgRect;
  systemId: string;
  staffId: string;
  measureId: string;
  anchor: { x: number; y: number };
  rootCoordinateSource: "frozen_root_svg";
};

export type ExportPlaybackGeometry = {
  pageNumber: number;
  system: ExportScoreSystem;
  notes: ExportNoteGeometry[];
  anchorNote: ExportNoteGeometry;
  activeColumn: SvgRect;
  previousAnchorX: number | null;
  nextAnchorX: number | null;
};

export type ScorePageCacheEntry = {
  pageNumber: number;
  image: HTMLImageElement;
  baseSvgText: string;
  viewBox: SvgViewBox;
  geometryByNoteId: Map<string, ExportNoteGeometry | null>;
  systems: ExportScoreSystem[];
  measureCount: number;
  eventImages: Map<string, HTMLImageElement>;
  eventImagePromises: Map<string, Promise<HTMLImageElement>>;
  eventImageLoader: ScorePageImageLoader;
};

export type ScorePageCache = Map<number, ScorePageCacheEntry>;

export type CompositeScoreModel = Readonly<{
  pages: ScorePageCache;
  adapter: PracticeVerovioAdapter;
  dispose(): void;
}>;

/** Each operation renders its own clean notation and freezes root-SVG geometry. */
export async function prepareCompositeScoreModel(
  {
    musicXml,
    artifact,
    signal,
  }: {
    musicXml: string;
    artifact: PracticeScoreArtifact;
    signal?: AbortSignal;
  },
  loadImage: ScorePageImageLoader = loadImageFromSvg,
): Promise<CompositeScoreModel> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const adapter = new PracticeVerovioAdapter(artifact);
  const host = document.createElement("div");
  host.dataset.compositeScoreHost = "true";
  Object.assign(host.style, {
    position: "fixed",
    left: "-100000px",
    top: "0",
    visibility: "hidden",
    pointerEvents: "none",
  });
  const pages: ScorePageCache = new Map();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    controller.abort();
    signal?.removeEventListener("abort", onAbort);
    for (const page of pages.values()) {
      page.eventImages.clear();
      page.eventImagePromises.clear();
    }
    pages.clear();
    host.remove();
    adapter.dispose();
  };
  try {
    signal?.throwIfAborted();
    await adapter.loadMusicXml(musicXml);
    signal?.throwIfAborted();
    const rendered = adapter.renderAllPages();
    if (!rendered.length)
      throw new Error("composite_video_failed:score_page_unavailable");
    document.body.appendChild(host);
    for (const page of rendered) {
      const node = document.createElement("div");
      node.dataset.compositeScorePage = String(page.pageNumber);
      node.innerHTML = page.svg;
      host.appendChild(node);
      const snapshot = snapshotPage(node);
      if (!snapshot)
        throw new Error("composite_video_failed:score_page_unavailable");
      const image = await loadImage(snapshot.svgText, controller.signal);
      signal?.throwIfAborted();
      pages.set(snapshot.pageNumber, {
        pageNumber: snapshot.pageNumber,
        image,
        baseSvgText: snapshot.svgText,
        viewBox: snapshot.viewBox,
        geometryByNoteId: snapshot.geometryByNoteId,
        systems: buildSystemViewports(snapshot.viewBox, snapshot.systems),
        measureCount: snapshot.measureCount,
        eventImages: new Map(),
        eventImagePromises: new Map(),
        eventImageLoader: (text) => loadImage(text, controller.signal),
      });
    }
    host.remove();
    return Object.freeze({ pages, adapter, dispose });
  } catch (error) {
    dispose();
    throw error;
  }
}

const MAX_EVENT_IMAGE_CACHE_ENTRIES = 24;

export async function getEventScoreImage(
  page: ScorePageCacheEntry,
  noteIds: readonly string[],
  anchorNoteId = noteIds[0] ?? "",
): Promise<HTMLImageElement> {
  const key = `${anchorNoteId}:${noteIds.join("|")}`;
  const cached = page.eventImages.get(key);
  if (cached) {
    page.eventImages.delete(key);
    page.eventImages.set(key, cached);
    return cached;
  }
  const pending = page.eventImagePromises.get(key);
  if (pending) {
    return pending;
  }

  const promise = buildEventScoreImage(page, noteIds, anchorNoteId, key);
  page.eventImagePromises.set(key, promise);
  try {
    return await promise;
  } finally {
    page.eventImagePromises.delete(key);
  }
}

async function buildEventScoreImage(
  page: ScorePageCacheEntry,
  noteIds: readonly string[],
  anchorNoteId: string,
  key: string,
): Promise<HTMLImageElement> {
  const eventImageLoader = page.eventImageLoader;
  const host = document.createElement("div");
  host.setAttribute("data-composite-video-host", "true");
  Object.assign(host.style, {
    position: "fixed",
    left: "-100000px",
    top: "0",
    width: `${page.viewBox.width}px`,
    height: `${page.viewBox.height}px`,
    visibility: "hidden",
    pointerEvents: "none",
    overflow: "hidden",
  });

  const template = document.createElement("template");
  template.innerHTML = page.baseSvgText;
  const svg = template.content.querySelector<SVGSVGElement>("svg");
  if (!svg) {
    throw new Error("composite_video_failed:event_score_svg_unavailable");
  }
  svg.setAttribute("width", String(page.viewBox.width));
  svg.setAttribute("height", String(page.viewBox.height));
  host.appendChild(svg);
  document.body.appendChild(host);

  try {
    const result = applyPlayheadCursor(host, noteIds);
    if (!result.geometry) {
      throw new Error("composite_video_failed:event_score_cursor_unavailable");
    }
    const cursorCount = svg.querySelectorAll(
      `[${SCORE_DECORATIONS.cursorAttribute}]`,
    ).length;
    if (cursorCount < 1 || cursorCount > 2) {
      throw new Error("composite_video_failed:event_score_cursor_count");
    }
    const svgText = new XMLSerializer().serializeToString(svg);
    const image = await eventImageLoader(svgText);
    page.eventImages.set(key, image);
    while (page.eventImages.size > MAX_EVENT_IMAGE_CACHE_ENTRIES) {
      const oldestKey = page.eventImages.keys().next().value as
        | string
        | undefined;
      if (!oldestKey) break;
      page.eventImages.delete(oldestKey);
    }
    return image;
  } finally {
    host.remove();
  }
}

export function prefetchEventScoreImage(
  page: ScorePageCacheEntry,
  noteIds: readonly string[],
  anchorNoteId = noteIds[0] ?? "",
): Promise<HTMLImageElement> {
  return getEventScoreImage(page, noteIds, anchorNoteId);
}

export function findStablePageNumber(
  noteIds: readonly string[],
  scorePages: ScorePageCache,
) {
  const matches = Array.from(scorePages.values()).filter((page) =>
    noteIds.every((noteId) => page.geometryByNoteId.get(noteId)),
  );
  return matches.length === 1 ? matches[0].pageNumber : null;
}

export function resolveExportPlaybackGeometry(
  page: ScorePageCacheEntry,
  noteIds: readonly string[],
): ExportPlaybackGeometry | null {
  const notes = noteIds
    .map((noteId) => page.geometryByNoteId.get(noteId))
    .filter((geometry): geometry is ExportNoteGeometry => Boolean(geometry));
  if (notes.length !== noteIds.length || notes.length === 0) return null;

  const primaryStaffId = choosePrimaryStaff(notes);
  const sameStaff = notes.filter((note) => note.staffId === primaryStaffId);
  const anchorNote =
    sameStaff.slice().sort((a, b) => a.anchor.x - b.anchor.x)[0] ?? notes[0];
  const system = page.systems.find(
    (candidate) => candidate.systemId === anchorNote.systemId,
  );
  if (!system) return null;

  const activeColumn = sameStaff
    .map((note) => note.noteBox)
    .reduce(mergeHorizontalRects);
  const peers = Array.from(page.geometryByNoteId.values())
    .filter(
      (geometry): geometry is ExportNoteGeometry =>
        geometry !== null &&
        geometry !== undefined &&
        geometry.systemId === anchorNote.systemId &&
        geometry.staffId === primaryStaffId,
    )
    .sort((a, b) => a.anchor.x - b.anchor.x);
  const index = peers.findIndex((peer) => peer.noteId === anchorNote.noteId);
  return {
    pageNumber: page.pageNumber,
    system,
    notes,
    anchorNote,
    activeColumn,
    previousAnchorX: index > 0 ? peers[index - 1].anchor.x : null,
    nextAnchorX:
      index >= 0 && index < peers.length - 1 ? peers[index + 1].anchor.x : null,
  };
}

type PageSnapshot = {
  pageNumber: number;
  svgText: string;
  viewBox: SvgViewBox;
  geometryByNoteId: Map<string, ExportNoteGeometry | null>;
  systems: ExportScoreSystem[];
  measureCount: number;
};

function snapshotPage(page: HTMLElement): PageSnapshot | null {
  const pageNumber = Number.parseInt(page.dataset.compositeScorePage ?? "", 10);
  const svg = page.querySelector<SVGSVGElement>("svg");
  if (!Number.isFinite(pageNumber) || !svg || !svg.isConnected) return null;

  const viewBox = readSvgViewBox(svg);
  const systemElements = Array.from(
    svg.querySelectorAll<SVGGraphicsElement>('.system, [data-class="system"]'),
  );
  const systemIndex = new Map(
    systemElements.map((element, index) => [element, index]),
  );
  const systems: ExportScoreSystem[] = [];
  systemElements.forEach((element, order) => {
    const bounds = rootSvgRectForElement(svg, element);
    if (bounds) {
      const contentBounds = systemContentBounds(svg, element, bounds);
      systems.push({
        systemId: stableElementId(
          element,
          `page-${pageNumber}-system-${order + 1}`,
        ),
        pageNumber,
        order,
        bounds,
        contentBounds,
        viewport: bounds,
        staffBoundsById: new Map<string, SvgRect>(),
        measureIds: [],
      });
    }
  });

  const geometryByNoteId = new Map<string, ExportNoteGeometry | null>();
  svg
    .querySelectorAll<SVGGraphicsElement>("[data-id], [id]")
    .forEach((element) => {
      const noteId =
        element.getAttribute("data-id") ?? element.getAttribute("id");
      if (!noteId || !isLikelyNote(element)) return;
      const systemElement = element.closest<SVGGraphicsElement>(
        '.system, [data-class="system"]',
      );
      const order = systemElement ? systemIndex.get(systemElement) : undefined;
      const system =
        order === undefined
          ? undefined
          : systems.find((candidate) => candidate.order === order);
      const staffElement =
        element.closest<SVGGraphicsElement>('.staff, [data-class="staff"]') ??
        systemElement;
      const noteBox =
        snapshotPlayheadCursorGeometry(svg, [noteId])?.rootNoteBox ??
        rootSvgRectForElement(svg, element);
      if (!system || !staffElement || !noteBox) {
        geometryByNoteId.set(noteId, null);
        return;
      }
      const rawStaffBox = staffElement
        ? rootSvgRectForElement(svg, staffElement)
        : null;
      const rawSystemBox = systemElement
        ? rootSvgRectForElement(svg, systemElement)
        : null;
      const staffBox =
        rawStaffBox && rectsIntersect(rawStaffBox, viewBox)
          ? rawStaffBox
          : noteBox;
      const systemBox =
        rawSystemBox && rectsIntersect(rawSystemBox, viewBox)
          ? rawSystemBox
          : noteBox;
      if (!staffBox || !systemBox) {
        geometryByNoteId.set(noteId, null);
        return;
      }
      const staffId = stableElementId(
        staffElement,
        `${system.systemId}-staff-${system.staffBoundsById.size + 1}`,
      );
      const measureElement = element.closest<SVGGraphicsElement>(
        '.measure, [data-class="measure"]',
      );
      const measureId = measureElement
        ? stableElementId(measureElement, `${system.systemId}-measure-unknown`)
        : `${system.systemId}-measure-unknown`;
      system.staffBoundsById.set(staffId, staffBox);
      if (!system.measureIds.includes(measureId))
        system.measureIds.push(measureId);
      geometryByNoteId.set(noteId, {
        pageNumber,
        noteId,
        noteBox,
        staffBox,
        systemBox,
        systemId: system.systemId,
        staffId,
        measureId,
        anchor: {
          x: noteBox.x + noteBox.width / 2,
          y: noteBox.y + noteBox.height / 2,
        },
        rootCoordinateSource: "frozen_root_svg",
      });
    });

  for (const system of systems) {
    if (rectsIntersect(system.bounds, viewBox)) continue;
    const fallbackBounds = Array.from(geometryByNoteId.values())
      .filter(
        (geometry): geometry is ExportNoteGeometry =>
          geometry !== null &&
          geometry !== undefined &&
          geometry.systemId === system.systemId,
      )
      .map((geometry) => geometry.staffBox)
      .reduce(mergeRectsOrNull, null);
    if (fallbackBounds) {
      system.bounds = fallbackBounds;
      system.contentBounds = fallbackBounds;
      system.viewport = fallbackBounds;
    }
  }

  return {
    pageNumber,
    svgText: new XMLSerializer().serializeToString(svg),
    viewBox,
    geometryByNoteId,
    systems,
    measureCount: countMeasures(svg),
  };
}

function systemContentBounds(
  rootSvg: SVGSVGElement,
  systemElement: SVGGraphicsElement,
  fallback: SvgRect,
): SvgRect {
  const candidates = Array.from(
    systemElement.querySelectorAll<SVGGraphicsElement>("*"),
  )
    .filter((element) => {
      if (element.hasAttribute(SCORE_DECORATIONS.cursorAttribute)) return false;
      const dataClass = element.getAttribute("data-class") ?? "";
      const className = element.getAttribute("class") ?? "";
      return (
        !["section", "pb"].includes(dataClass) &&
        !className
          .split(/\s+/)
          .some(
            (name) =>
              name === "systemMilestone" || name === SCORE_DECORATIONS.cursor,
          )
      );
    })
    .map((element) => rootSvgRectForElement(rootSvg, element))
    .filter(
      (rect): rect is SvgRect =>
        rect !== null && rect.width > 0 && rect.height > 0,
    )
    .filter((rect) => rectsIntersect(rect, readSvgViewBox(rootSvg)));

  const contentBounds = candidates.reduce(mergeRectsOrNull, null);
  return contentBounds ?? fallback;
}

function buildSystemViewports(
  viewBox: SvgViewBox,
  systems: ExportScoreSystem[],
) {
  const ordered = systems.slice().sort((a, b) => a.bounds.y - b.bounds.y);
  return systems.map((system) => {
    const index = ordered.findIndex(
      (candidate) => candidate.systemId === system.systemId,
    );
    let top = system.bounds.y;
    let bottom = system.bounds.y + system.bounds.height;
    for (const neighbor of [ordered[index - 1], ordered[index + 1]]) {
      if (!neighbor) continue;
      const candidateTop = Math.min(top, neighbor.bounds.y);
      const candidateBottom = Math.max(
        bottom,
        neighbor.bounds.y + neighbor.bounds.height,
      );
      if (candidateBottom - candidateTop <= viewBox.height) {
        top = candidateTop;
        bottom = candidateBottom;
      }
    }
    return {
      ...system,
      viewport: {
        x: viewBox.x,
        y: Math.max(viewBox.y, top),
        width: viewBox.width,
        height: Math.min(viewBox.height, bottom - top),
      },
    };
  });
}

function choosePrimaryStaff(notes: ExportNoteGeometry[]) {
  const groups = new Map<string, ExportNoteGeometry[]>();
  for (const note of notes)
    groups.set(note.staffId, [...(groups.get(note.staffId) ?? []), note]);
  return Array.from(groups.values()).sort(
    (a, b) =>
      Math.min(...a.map((note) => note.staffBox.y)) -
      Math.min(...b.map((note) => note.staffBox.y)),
  )[0][0].staffId;
}

function mergeHorizontalRects(a: SvgRect, b: SvgRect): SvgRect {
  const x = Math.min(a.x, b.x);
  return {
    x,
    y: a.y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: a.height,
  };
}

function stableElementId(element: SVGGraphicsElement, fallback: string) {
  return element.getAttribute("data-id") || element.id || fallback;
}

function isLikelyNote(element: SVGGraphicsElement) {
  const className = element.getAttribute("class") ?? "";
  const dataClass = element.getAttribute("data-class") ?? "";
  const id = element.getAttribute("data-id") ?? element.id;
  if (
    !id ||
    ["system", "staff", "measure", "page", "beam", "layer"].includes(dataClass)
  ) {
    return false;
  }
  return (
    className.split(/\s+/).includes("note") ||
    dataClass === "note" ||
    /(?:^|-)note(?:\d+|[a-z])?(?:-|$)/i.test(id) ||
    /(?:^|-)chord(?:\d+|[a-z])?(?:-|$)/i.test(id)
  );
}

function readSvgViewBox(svg: SVGSVGElement): SvgViewBox {
  const raw = svg.getAttribute("viewBox")?.trim();
  if (raw) {
    const [x, y, width, height] = raw.split(/[\s,]+/).map(Number.parseFloat);
    if (
      [x, y, width, height].every(Number.isFinite) &&
      width > 0 &&
      height > 0
    ) {
      return { x, y, width, height };
    }
  }
  return {
    x: 0,
    y: 0,
    width: Number.parseFloat(svg.getAttribute("width") ?? "") || 1200,
    height: Number.parseFloat(svg.getAttribute("height") ?? "") || 1600,
  };
}

function countMeasures(svg: SVGSVGElement) {
  return new Set(
    Array.from(
      svg.querySelectorAll<SVGElement>('.measure, [data-class="measure"]'),
    )
      .map((element) => element.getAttribute("data-id") ?? element.id)
      .filter(Boolean),
  ).size;
}

function rectsIntersect(first: SvgRect, second: SvgRect) {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

function mergeRectsOrNull(current: SvgRect | null, next: SvgRect): SvgRect {
  if (!current) return { ...next };
  const x = Math.min(current.x, next.x);
  const y = Math.min(current.y, next.y);
  const right = Math.max(current.x + current.width, next.x + next.width);
  const bottom = Math.max(current.y + current.height, next.y + next.height);
  return { x, y, width: right - x, height: bottom - y };
}

function loadImageFromSvg(
  svgText: string,
  signal?: AbortSignal,
): Promise<HTMLImageElement> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(
      new Blob([svgText], { type: "image/svg+xml;charset=utf-8" }),
    );
    const image = new Image();
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener("abort", onAbort);
      URL.revokeObjectURL(url);
    };
    const onAbort = () => {
      cleanup();
      image.removeAttribute("src");
      reject(new DOMException("Composite cancelled", "AbortError"));
    };
    image.onload = () => {
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error("composite_video_failed:score_image_decode"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    image.src = url;
  });
}
