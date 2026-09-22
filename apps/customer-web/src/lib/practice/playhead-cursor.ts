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
  box: SvgRect;
  noteBox: SvgRect;
  systemBox: SvgRect;
};

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
  noteIds: readonly string[]
): PlayheadCursorGeometry | null {
  const notes = Array.from(new Set(noteIds.filter(Boolean)))
    .map((noteId) => findElementByVerovioId(container, noteId))
    .filter((node): node is SVGGraphicsElement => node !== null);
  if (notes.length === 0) {
    return null;
  }

  const firstLayer = getCursorLayer(notes[0]);
  if (!firstLayer) {
    return null;
  }

  const noteBoxes: SvgRect[] = [];
  for (const note of notes) {
    if (getCursorLayer(note) !== firstLayer) {
      continue;
    }
    const box = getElementBoxInLayer(note, firstLayer);
    if (box && box.width > 0 && box.height > 0) {
      noteBoxes.push(box);
    }
  }
  if (noteBoxes.length === 0) {
    return null;
  }

  const noteBox = noteBoxes.reduce(mergeRects);
  const systemBox = getSystemBox(firstLayer, noteBox);
  const cursorWidth = Math.min(
    72,
    Math.max(18, noteBox.width + Math.max(14, noteBox.width * 0.7))
  );
  const centerX = noteBox.x + noteBox.width / 2;
  const paddingY = Math.max(8, systemBox.height * 0.035);
  const box = {
    x: centerX - cursorWidth / 2,
    y: systemBox.y - paddingY,
    width: cursorWidth,
    height: systemBox.height + paddingY * 2,
  };
  return {
    layer: firstLayer,
    box,
    noteBox,
    systemBox,
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

  const transformed = transformBoxToLayer(element, layer, box);
  if (transformed) {
    return transformed;
  }
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
  };
}

function transformBoxToLayer(
  element: SVGGraphicsElement,
  layer: SVGGraphicsElement,
  box: DOMRect
): SvgRect | null {
  const svg = element.ownerSVGElement;
  if (!svg || typeof svg.createSVGPoint !== 'function') {
    return null;
  }
  const elementCtm = element.getCTM?.();
  const layerCtm = layer.getCTM?.();
  const inverseLayerCtm = layerCtm?.inverse?.();
  if (!elementCtm || !inverseLayerCtm) {
    return null;
  }
  const matrix = inverseLayerCtm.multiply(elementCtm);
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
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
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
