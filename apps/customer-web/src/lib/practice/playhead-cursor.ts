export const PLAYHEAD_CURSOR_CLASS = 'practice-playhead-cursor';
export const PLAYHEAD_CURSOR_DATA_ATTR = 'data-practice-playhead-cursor';

export const PLAYHEAD_CURSOR_STYLE = {
  fill: 'rgba(251, 191, 36, 0.22)',
  stroke: 'rgba(245, 158, 11, 0.46)',
  shadow: 'rgba(245, 158, 11, 0.24)',
  radius: 4,
};

export type SvgRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PlayheadCursorGeometry = {
  layer: SVGGraphicsElement;
  rootSvg: SVGSVGElement;
  box: SvgRect;
  noteBox: SvgRect;
  systemBox: SvgRect;
  rootBox: SvgRect | null;
  rootNoteBox: SvgRect | null;
  rootSystemBox: SvgRect | null;
  rootFailureReason: PlayheadCursorGeometryFailureReason | null;
};

export type PlayheadCursorGeometryFailureReason =
  | 'root_svg_unavailable'
  | 'root_svg_disconnected'
  | 'matrix_unavailable'
  | 'matrix_not_invertible'
  | 'non_finite_root_rect';

export function cssStringLiteral(value: string) {
  return JSON.stringify(value);
}

export function escapeCssId(id: string) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(id);
  }
  return id.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

export function findElementByVerovioId(
  container: ParentNode,
  verovioId: string
): SVGGraphicsElement | null {
  return (
    container.querySelector<SVGGraphicsElement>(`[data-id=${cssStringLiteral(verovioId)}]`) ??
    container.querySelector<SVGGraphicsElement>(`#${escapeCssId(verovioId)}`)
  );
}

export function clearPlayheadCursor(container: ParentNode) {
  container
    .querySelectorAll(`[${PLAYHEAD_CURSOR_DATA_ATTR}]`)
    .forEach((element) => element.remove());
}

export function applyPlayheadCursor(
  container: HTMLElement,
  noteIds: readonly string[]
): { anchor: Element | null; geometry: PlayheadCursorGeometry | null } {
  clearPlayheadCursor(container);
  const geometry = getPlayheadCursorGeometry(container, noteIds);
  if (!geometry) {
    return { anchor: null, geometry: null };
  }

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute(PLAYHEAD_CURSOR_DATA_ATTR, 'true');
  rect.setAttribute('class', PLAYHEAD_CURSOR_CLASS);
  rect.setAttribute('x', String(geometry.box.x));
  rect.setAttribute('y', String(geometry.box.y));
  rect.setAttribute('width', String(geometry.box.width));
  rect.setAttribute('height', String(geometry.box.height));
  rect.setAttribute('rx', String(PLAYHEAD_CURSOR_STYLE.radius));
  rect.setAttribute('fill', PLAYHEAD_CURSOR_STYLE.fill);
  rect.setAttribute('stroke', PLAYHEAD_CURSOR_STYLE.stroke);
  rect.setAttribute('stroke-width', '1.5');
  rect.setAttribute('pointer-events', 'none');
  geometry.layer.insertBefore(rect, geometry.layer.firstChild);

  const anchor = noteIds
    .map((noteId) => findElementByVerovioId(container, noteId))
    .find((node): node is SVGGraphicsElement => node !== null) ?? null;
  return { anchor, geometry };
}

export function getPlayheadCursorGeometry(
  container: ParentNode,
  noteIds: readonly string[],
  options: { requireRootCoordinates?: boolean } = {}
): PlayheadCursorGeometry | null {
  const allNotes = Array.from(new Set(noteIds.filter(Boolean)))
    .map((noteId) => findElementByVerovioId(container, noteId))
    .filter((node): node is SVGGraphicsElement => node !== null);
  if (allNotes.length === 0) {
    return null;
  }

  const firstLayer = getCursorLayer(allNotes[0]);
  if (!firstLayer) {
    return null;
  }

  const noteBoxes: SvgRect[] = [];
  const notes: SVGGraphicsElement[] = [];
  for (const note of allNotes) {
    if (getCursorLayer(note) !== firstLayer) {
      continue;
    }
    const box = getElementBoxInLayer(note, firstLayer);
    if (box && box.width > 0 && box.height > 0) {
      noteBoxes.push(box);
      notes.push(note);
    }
  }
  if (noteBoxes.length === 0) {
    return null;
  }

  const noteBox = noteBoxes.reduce(mergeRects);
  const systemBox = getSystemBox(firstLayer, noteBox);
  const box = cursorBoxFor(noteBox, systemBox);
  const rootSvg = firstLayer instanceof SVGSVGElement ? firstLayer : firstLayer.ownerSVGElement;
  if (!rootSvg) {
    return null;
  }
  const renderedRoot = getRenderedRootGeometry(rootSvg, firstLayer, notes);
  const rootBoxResult = renderedRoot
    ? ({ ok: true, rect: renderedRoot.rootBox } as const)
    : transformRectBetween(firstLayer, rootSvg, box);
  const rootNoteBoxResult = renderedRoot
    ? ({ ok: true, rect: renderedRoot.rootNoteBox } as const)
    : transformRectBetween(firstLayer, rootSvg, noteBox);
  const rootSystemBoxResult = renderedRoot
    ? ({ ok: true, rect: renderedRoot.rootSystemBox } as const)
    : transformRectBetween(firstLayer, rootSvg, systemBox);
  const rootFailureReason = firstFailureReason(
    rootBoxResult,
    rootNoteBoxResult,
    rootSystemBoxResult
  );
  if (options.requireRootCoordinates && rootFailureReason) {
    return null;
  }
  return {
    layer: firstLayer,
    rootSvg,
    box,
    noteBox,
    systemBox,
    rootBox: rootBoxResult.ok ? rootBoxResult.rect : null,
    rootNoteBox: rootNoteBoxResult.ok ? rootNoteBoxResult.rect : null,
    rootSystemBox: rootSystemBoxResult.ok ? rootSystemBoxResult.rect : null,
    rootFailureReason,
  };
}

function getCursorLayer(note: SVGGraphicsElement): SVGGraphicsElement | null {
  return note.closest<SVGGraphicsElement>('.system') ?? note.ownerSVGElement;
}

function getSystemBox(layer: SVGGraphicsElement, fallback: SvgRect): SvgRect {
  try {
    const box = layer.getBBox();
    if (box.width > 0 && box.height > 0) {
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      };
    }
  } catch {
    // Fall through to the note box when the browser cannot provide system geometry.
  }
  return fallback;
}

function cursorBoxFor(noteBox: SvgRect, systemBox: SvgRect): SvgRect {
  const paddingX = Math.max(8, noteBox.width * 0.08);
  const paddingY = Math.max(8, systemBox.height * 0.035);
  return {
    x: noteBox.x - paddingX,
    y: systemBox.y - paddingY,
    width: noteBox.width + paddingX * 2,
    height: systemBox.height + paddingY * 2,
  };
}

function getRenderedRootGeometry(
  rootSvg: SVGSVGElement,
  layer: SVGGraphicsElement,
  notes: readonly SVGGraphicsElement[]
): { rootBox: SvgRect; rootNoteBox: SvgRect; rootSystemBox: SvgRect } | null {
  const rootNoteBoxes = notes
    .map((note) => renderedRectToRootSvg(rootSvg, note))
    .filter((box): box is SvgRect => box !== null);
  if (rootNoteBoxes.length === 0) {
    return null;
  }
  const rootNoteBox = rootNoteBoxes.reduce(mergeRects);
  const rootSystemBox = renderedRectToRootSvg(rootSvg, layer) ?? rootNoteBox;
  const rootBox = cursorBoxFor(rootNoteBox, rootSystemBox);
  if (![rootBox, rootNoteBox, rootSystemBox].every(isFiniteRect)) {
    return null;
  }
  return { rootBox, rootNoteBox, rootSystemBox };
}

function renderedRectToRootSvg(rootSvg: SVGSVGElement, element: SVGGraphicsElement): SvgRect | null {
  const rootRect = rootSvg.getBoundingClientRect?.();
  const elementRect = element.getBoundingClientRect?.();
  if (
    !rootRect ||
    !elementRect ||
    rootRect.width <= 0 ||
    rootRect.height <= 0 ||
    elementRect.width <= 0 ||
    elementRect.height <= 0
  ) {
    return null;
  }
  const viewBox = readSvgViewBox(rootSvg);
  const x = viewBox.x + ((elementRect.left - rootRect.left) / rootRect.width) * viewBox.width;
  const y = viewBox.y + ((elementRect.top - rootRect.top) / rootRect.height) * viewBox.height;
  const width = (elementRect.width / rootRect.width) * viewBox.width;
  const height = (elementRect.height / rootRect.height) * viewBox.height;
  const rect = { x, y, width, height };
  return isFiniteRect(rect) ? rect : null;
}

function readSvgViewBox(svg: SVGSVGElement): SvgRect {
  const rawViewBox = svg.getAttribute('viewBox')?.trim();
  if (rawViewBox) {
    const [x, y, width, height] = rawViewBox
      .split(/[\s,]+/)
      .map((value) => Number.parseFloat(value));
    if ([x, y, width, height].every((value) => Number.isFinite(value)) && width > 0 && height > 0) {
      return { x, y, width, height };
    }
  }
  const width = Number.parseFloat(svg.getAttribute('width') ?? '') || 1;
  const height = Number.parseFloat(svg.getAttribute('height') ?? '') || 1;
  return { x: 0, y: 0, width, height };
}

function getElementBoxInLayer(
  element: SVGGraphicsElement,
  layer: SVGGraphicsElement
): SvgRect | null {
  let box: DOMRect;
  try {
    box = element.getBBox();
  } catch {
    return null;
  }

  const transformed = transformRectBetween(element, layer, {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
  });
  if (transformed.ok) {
    return transformed.rect;
  }
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
  };
}

function transformRectBetween(
  from: SVGGraphicsElement,
  to: SVGGraphicsElement,
  box: SvgRect
): { ok: true; rect: SvgRect } | { ok: false; reason: PlayheadCursorGeometryFailureReason } {
  const svg = from.ownerSVGElement;
  if (!svg || typeof svg.createSVGPoint !== 'function') {
    return from === to ? { ok: true, rect: box } : { ok: false, reason: 'root_svg_unavailable' };
  }
  if (from === to) {
    return { ok: true, rect: box };
  }
  if (!from.isConnected || !to.isConnected || !svg.isConnected) {
    return { ok: false, reason: 'root_svg_disconnected' };
  }
  const fromCtm = from.getCTM?.();
  const toCtm = to.getCTM?.();
  if (!fromCtm || !toCtm || typeof toCtm.inverse !== 'function') {
    return { ok: false, reason: 'matrix_unavailable' };
  }
  let inverseToCtm: DOMMatrix;
  try {
    inverseToCtm = toCtm.inverse();
  } catch {
    return { ok: false, reason: 'matrix_not_invertible' };
  }
  const matrix = inverseToCtm.multiply(fromCtm);
  const corners = [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x, box.y + box.height],
    [box.x + box.width, box.y + box.height],
  ].map(([x, y]) => {
    const point = svg.createSVGPoint();
    point.x = x;
    point.y = y;
    return point.matrixTransform(matrix);
  });
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  const rect = {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
  if (!isFiniteRect(rect)) {
    return { ok: false, reason: 'non_finite_root_rect' };
  }
  return { ok: true, rect };
}

function firstFailureReason(
  ...results: Array<
    { ok: true; rect: SvgRect } | { ok: false; reason: PlayheadCursorGeometryFailureReason }
  >
) {
  return results.find((result) => !result.ok)?.reason ?? null;
}

function isFiniteRect(rect: SvgRect) {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function mergeRects(first: SvgRect, second: SvgRect): SvgRect {
  const x = Math.min(first.x, second.x);
  const y = Math.min(first.y, second.y);
  const right = Math.max(first.x + first.width, second.x + second.width);
  const bottom = Math.max(first.y + first.height, second.y + second.height);
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}
