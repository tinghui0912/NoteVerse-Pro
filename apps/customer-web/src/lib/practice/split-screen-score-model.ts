import {
  snapshotPlayheadCursorGeometry,
  type PlayheadCursorGeometrySnapshot,
  type SvgRect,
} from './playhead-cursor';

export type SvgViewBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ScorePageImageLoader = (svgText: string) => Promise<HTMLImageElement>;

export type ExportNoteGeometry = {
  pageNumber: number;
  noteId: string;
  noteBox: SvgRect;
  lineBox: SvgRect;
  rootCoordinateSource: PlayheadCursorGeometrySnapshot['rootCoordinateSource'];
};

export type ScorePageCacheEntry = {
  pageNumber: number;
  image: HTMLImageElement;
  viewBox: SvgViewBox;
  geometryByNoteId: Map<string, ExportNoteGeometry | null>;
  measureCount: number;
};

export type ScorePageCache = Map<number, ScorePageCacheEntry>;

export async function prepareScorePageCache(
  scoreContainer: HTMLElement,
  loadImage: ScorePageImageLoader = loadImageFromSvg
): Promise<ScorePageCache> {
  const pageNodes = Array.from(
    scoreContainer.querySelectorAll<HTMLElement>('[data-practice-review-page]')
  );
  const pages = pageNodes.length > 0
    ? pageNodes
    : Array.from(scoreContainer.querySelectorAll<HTMLElement>('[data-score-page]'));
  if (pages.length === 0) {
    throw new Error('split_screen_export_failed:score_page_unavailable');
  }

  const cache: ScorePageCache = new Map();
  const pageSnapshots = pages.map((page) => {
    const pageNumber = Number.parseInt(
      page.dataset.practiceReviewPage ?? page.dataset.scorePage ?? '',
      10
    );
    const svg = page.querySelector<SVGSVGElement>('svg');
    if (!Number.isFinite(pageNumber) || !svg) {
      return null;
    }
    const cleanSvg = cloneScoreSvgWithoutRuntimeHighlights(svg);
    const svgText = new XMLSerializer().serializeToString(cleanSvg);
    const geometryByNoteId = new Map<string, ExportNoteGeometry | null>();
    svg.querySelectorAll<SVGGraphicsElement>('[data-id], [id]').forEach((element) => {
      const noteId = element.getAttribute('data-id') ?? element.getAttribute('id');
      if (noteId && hasSvgGeometry(element)) {
        geometryByNoteId.set(noteId, snapshotExportNoteGeometry(svg, pageNumber, noteId));
      }
    });
    return {
      pageNumber,
      svgText,
      geometryByNoteId,
      measureCount: countMeasures(svg),
      viewBox: readSvgViewBox(svg),
    };
  }).filter((snapshot): snapshot is {
    pageNumber: number;
    svgText: string;
    geometryByNoteId: Map<string, ExportNoteGeometry | null>;
    measureCount: number;
    viewBox: SvgViewBox;
  } => snapshot !== null);

  for (const snapshot of pageSnapshots) {
    cache.set(snapshot.pageNumber, {
      pageNumber: snapshot.pageNumber,
      image: await loadImage(snapshot.svgText),
      geometryByNoteId: snapshot.geometryByNoteId,
      measureCount: snapshot.measureCount,
      viewBox: snapshot.viewBox,
    });
  }

  if (cache.size === 0) {
    throw new Error('split_screen_export_failed:score_page_unavailable');
  }
  return cache;
}

export function findStablePageNumber(
  noteIds: readonly string[],
  scorePages: ScorePageCache
): number | null {
  const matchingPages = Array.from(scorePages.values()).filter((page) =>
    noteIds.every((noteId) => {
      const geometry = page.geometryByNoteId.get(noteId);
      return geometry !== undefined && geometry !== null;
    })
  );
  return matchingPages.length === 1 ? matchingPages[0].pageNumber : null;
}

export function firstScorePage(scorePages: ScorePageCache): ScorePageCacheEntry {
  const first = scorePages.values().next().value as ScorePageCacheEntry | undefined;
  if (!first) {
    throw new Error('split_screen_export_failed:score_page_unavailable');
  }
  return first;
}

export function mergeExportNoteGeometries(
  geometries: readonly ExportNoteGeometry[]
): { activeNoteBox: SvgRect; lineBox: SvgRect; rootCoordinateSource: ExportNoteGeometry['rootCoordinateSource'] } | null {
  if (geometries.length === 0) {
    return null;
  }
  const pageNumber = geometries[0].pageNumber;
  if (geometries.some((geometry) => geometry.pageNumber !== pageNumber)) {
    return null;
  }
  return {
    activeNoteBox: geometries.map((geometry) => geometry.noteBox).reduce(mergeRects),
    lineBox: geometries.map((geometry) => geometry.lineBox).reduce(mergeRects),
    rootCoordinateSource: geometries[0].rootCoordinateSource,
  };
}

export function readSvgViewBox(svg: SVGSVGElement): SvgViewBox {
  const rawViewBox = svg.getAttribute('viewBox')?.trim();
  if (rawViewBox) {
    const [x, y, width, height] = rawViewBox
      .split(/[\s,]+/)
      .map((value) => Number.parseFloat(value));
    if ([x, y, width, height].every((value) => Number.isFinite(value)) && width > 0 && height > 0) {
      return { x, y, width, height };
    }
  }
  const width = Number.parseFloat(svg.getAttribute('width') ?? '') || 1200;
  const height = Number.parseFloat(svg.getAttribute('height') ?? '') || 1600;
  return { x: 0, y: 0, width, height };
}

function snapshotExportNoteGeometry(
  svg: SVGSVGElement,
  pageNumber: number,
  noteId: string
): ExportNoteGeometry | null {
  const snapshot = snapshotPlayheadCursorGeometry(svg, [noteId]);
  if (!snapshot?.rootNoteBox || !snapshot.rootSystemBox) {
    return null;
  }
  return {
    pageNumber,
    noteId,
    noteBox: snapshot.rootNoteBox,
    lineBox: snapshot.rootSystemBox,
    rootCoordinateSource: snapshot.rootCoordinateSource,
  };
}

function hasSvgGeometry(element: SVGGraphicsElement) {
  try {
    const box = element.getBBox();
    return Number.isFinite(box.x) && Number.isFinite(box.y) && box.width > 0 && box.height > 0;
  } catch {
    return false;
  }
}

function countMeasures(svg: SVGSVGElement) {
  const measureNumbers = new Set<string>();
  svg.querySelectorAll<SVGElement>('[data-id], [id], .measure').forEach((element) => {
    const value = element.getAttribute('data-id') ?? element.getAttribute('id') ?? '';
    const match = value.match(/(?:^|-)m(\d+)(?:-|$)/i);
    if (match) {
      measureNumbers.add(match[1]);
    } else if (element.classList.contains('measure')) {
      measureNumbers.add(value || String(measureNumbers.size + 1));
    }
  });
  return measureNumbers.size;
}

function cloneScoreSvgWithoutRuntimeHighlights(svg: SVGSVGElement): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const viewBox = readSvgViewBox(svg);
  clone.setAttribute('width', clone.getAttribute('width') || String(viewBox.width));
  clone.setAttribute('height', clone.getAttribute('height') || String(viewBox.height));
  removeOpaquePageBackgrounds(clone, viewBox);
  clone
    .querySelectorAll('.practice-note-active, .practice-playhead-cursor, [data-practice-playhead-cursor]')
    .forEach((element) => element.classList.remove('practice-note-active'));
  clone
    .querySelectorAll('.practice-playhead-cursor, [data-practice-playhead-cursor]')
    .forEach((element) => element.remove());
  return clone;
}

function removeOpaquePageBackgrounds(svg: SVGSVGElement, viewBox: SvgViewBox) {
  Array.from(svg.children).forEach((child) => {
    if (child.tagName.toLowerCase() !== 'rect') {
      return;
    }
    const fill = (child.getAttribute('fill') ?? '').trim().toLowerCase();
    const style = (child.getAttribute('style') ?? '').toLowerCase();
    const isWhiteFill =
      fill === '#fff' ||
      fill === '#ffffff' ||
      fill === 'white' ||
      /fill\s*:\s*(#fff|#ffffff|white|rgb\(255,\s*255,\s*255\))/.test(style);
    if (!isWhiteFill) {
      return;
    }
    const x = Number.parseFloat(child.getAttribute('x') ?? String(viewBox.x));
    const y = Number.parseFloat(child.getAttribute('y') ?? String(viewBox.y));
    const width = Number.parseFloat(child.getAttribute('width') ?? String(viewBox.width));
    const height = Number.parseFloat(child.getAttribute('height') ?? String(viewBox.height));
    const coversPage =
      x <= viewBox.x + 1 &&
      y <= viewBox.y + 1 &&
      x + width >= viewBox.x + viewBox.width - 1 &&
      y + height >= viewBox.y + viewBox.height - 1;
    if (coversPage) {
      child.remove();
    }
  });
}

function loadImageFromSvg(svgText: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('split_screen_export_failed:score_image_decode'));
    };
    image.src = url;
  });
}

function mergeRects(first: SvgRect, second: SvgRect): SvgRect {
  const x = Math.min(first.x, second.x);
  const y = Math.min(first.y, second.y);
  const right = Math.max(first.x + first.width, second.x + second.width);
  const bottom = Math.max(first.y + first.height, second.y + second.height);
  return { x, y, width: right - x, height: bottom - y };
}
