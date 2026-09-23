export const PLAYHEAD_CURSOR_CLASS = 'practice-playhead-cursor';
export const PLAYHEAD_CURSOR_DATA_ATTR = 'data-practice-playhead-cursor';

export const PLAYHEAD_CURSOR_STYLE = {
  radius: 4,
};

export type PlayheadStaffRole = 'treble' | 'bass' | 'other';

export const PLAYHEAD_CURSOR_STYLES: Record<
  PlayheadStaffRole,
  { fill: string; stroke: string; shadow: string }
> = {
  treble: {
    fill: 'rgba(251, 191, 36, 0.22)',
    stroke: 'rgba(245, 158, 11, 0.46)',
    shadow: 'rgba(245, 158, 11, 0.24)',
  },
  bass: {
    fill: 'rgba(125, 211, 252, 0.24)',
    stroke: 'rgba(14, 165, 233, 0.48)',
    shadow: 'rgba(14, 165, 233, 0.22)',
  },
  other: {
    fill: 'rgba(251, 191, 36, 0.22)',
    stroke: 'rgba(245, 158, 11, 0.46)',
    shadow: 'rgba(245, 158, 11, 0.24)',
  },
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
  rootCoordinateSource: PlayheadRootCoordinateSource | null;
  rootFailureReason: PlayheadCursorGeometryFailureReason | null;
};

export type PlayheadCursorGeometrySnapshot = Pick<
  PlayheadCursorGeometry,
  | 'box'
  | 'noteBox'
  | 'systemBox'
  | 'rootBox'
  | 'rootNoteBox'
  | 'rootSystemBox'
  | 'rootCoordinateSource'
  | 'rootFailureReason'
>;

export type ExportPlayheadCursorGeometry = {
  layer: SVGGraphicsElement;
  rootSvg: SVGSVGElement;
  box: SvgRect;
  noteBox: SvgRect;
  staffBox: SvgRect;
};

export type ActivePlayheadStaffGroup = {
  layer: SVGGraphicsElement;
  staff: SVGGraphicsElement;
  role: PlayheadStaffRole;
  noteIds: string[];
};

export type PlayheadRootCoordinateSource =
  | 'ctm_svg_viewport'
  | 'rendered_dom_rect'
  | 'matrix_to_root';

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
  const groups = groupActiveNotesByStaff(container, noteIds);
  let firstGeometry: PlayheadCursorGeometry | null = null;
  let firstAnchor: SVGGraphicsElement | null = null;
  for (const group of groups) {
    const geometry = getPlayheadCursorGeometryForGroup(group, container);
    if (!geometry) continue;
    const style = PLAYHEAD_CURSOR_STYLES[group.role];
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute(PLAYHEAD_CURSOR_DATA_ATTR, 'true');
    rect.setAttribute('class', PLAYHEAD_CURSOR_CLASS);
    rect.setAttribute('data-playhead-staff', group.role);
    rect.setAttribute('x', String(geometry.box.x));
    rect.setAttribute('y', String(geometry.box.y));
    rect.setAttribute('width', String(geometry.box.width));
    rect.setAttribute('height', String(geometry.box.height));
    rect.setAttribute('rx', String(PLAYHEAD_CURSOR_STYLE.radius));
    rect.setAttribute('fill', style.fill);
    rect.setAttribute('stroke', style.stroke);
    rect.setAttribute('stroke-width', '1.5');
    rect.setAttribute('pointer-events', 'none');
    geometry.layer.insertBefore(rect, geometry.layer.firstChild);
    firstGeometry ??= geometry;
    firstAnchor ??= group.noteIds
      .map((noteId) => findElementByVerovioId(container, noteId))
      .find((node): node is SVGGraphicsElement => node !== null) ?? null;
  }
  return { anchor: firstAnchor, geometry: firstGeometry };
}

export function applyExportPlayheadCursor(
  container: HTMLElement,
  noteIds: readonly string[],
  anchorNoteId: string
): { anchor: SVGGraphicsElement | null; geometry: ExportPlayheadCursorGeometry | null } {
  const result = applyPlayheadCursor(container, noteIds);
  const anchor = findElementByVerovioId(container, anchorNoteId) ?? result.anchor;
  if (!result.geometry || !anchor) {
    return { anchor: anchor as SVGGraphicsElement | null, geometry: null };
  }
  return {
    anchor: anchor as SVGGraphicsElement,
    geometry: {
      layer: result.geometry.layer,
      rootSvg: result.geometry.rootSvg,
      box: result.geometry.box,
      noteBox: result.geometry.noteBox,
      staffBox: result.geometry.systemBox,
    },
  };
}

export function groupActiveNotesByStaff(
  container: ParentNode,
  noteIds: readonly string[]
): ActivePlayheadStaffGroup[] {
  const groups = new Map<SVGGraphicsElement, ActivePlayheadStaffGroup>();
  for (const noteId of Array.from(new Set(noteIds.filter(Boolean)))) {
    const note = findElementByVerovioId(container, noteId);
    if (!note) continue;
    const layer = getCursorLayer(note);
    if (!layer) continue;
    const staff = note.closest<SVGGraphicsElement>('.staff, [data-class="staff"]') ?? layer;
    const existing = groups.get(staff);
    if (existing) {
      existing.noteIds.push(noteId);
    } else {
      groups.set(staff, {
        layer,
        staff,
        role: staffRoleFor(staff, layer),
        noteIds: [noteId],
      });
    }
  }
  return Array.from(groups.values());
}

function getPlayheadCursorGeometryForGroup(
  group: ActivePlayheadStaffGroup,
  container: ParentNode
): PlayheadCursorGeometry | null {
  const notes = group.noteIds
    .map((noteId) => findElementByVerovioId(container, noteId))
    .filter((note): note is SVGGraphicsElement => note !== null);
  const noteBoxes = notes
    .map((note) => getElementBoxInLayer(note, group.layer))
    .filter((box): box is SvgRect => box !== null && box.width > 0 && box.height > 0);
  const noteBox = noteBoxes.reduce(mergeHorizontalRects, null);
  const staffBox = noteBox
    ? getElementBoxInLayer(group.staff, group.layer) ?? noteBox
    : null;
  const rootSvg = group.layer.ownerSVGElement;
  if (!noteBox || !staffBox || !rootSvg || notes.length === 0) return null;

  const horizontalPadding = Math.max(8, noteBox.width * 0.08);
  const verticalPadding = Math.max(8, staffBox.height * 0.06);
  const box = {
    x: noteBox.x - horizontalPadding,
    y: staffBox.y - verticalPadding,
    width: noteBox.width + horizontalPadding * 2,
    height: staffBox.height + verticalPadding * 2,
  };
  const renderedRoot = getRenderedRootGeometry(rootSvg, group.layer, notes);
  return {
    layer: group.layer,
    rootSvg,
    box,
    noteBox,
    systemBox: staffBox,
    rootBox: renderedRoot?.rootBox ?? null,
    rootNoteBox: renderedRoot?.rootNoteBox ?? null,
    rootSystemBox: renderedRoot?.rootSystemBox ?? null,
    rootCoordinateSource: renderedRoot?.source ?? null,
    rootFailureReason: renderedRoot ? null : 'matrix_unavailable',
  };
}

function staffRoleFor(staff: SVGGraphicsElement, layer: SVGGraphicsElement): PlayheadStaffRole {
  const explicitRole =
    staff.getAttribute('data-staff-role') ??
    staff.getAttribute('data-role') ??
    staff.getAttribute('aria-label') ??
    '';
  if (/bass|低音/i.test(explicitRole)) return 'bass';
  if (/treble|高音/i.test(explicitRole)) return 'treble';

  const staffElements = Array.from(
    layer.querySelectorAll<SVGGraphicsElement>('.staff, [data-class="staff"]')
  );
  if (staffElements.length <= 1) return 'treble';
  const ranked = staffElements
    .map((candidate) => ({
      candidate,
      y: getElementBoxInLayer(candidate, layer)?.y ?? Number.POSITIVE_INFINITY,
    }))
    .sort((first, second) => first.y - second.y);
  const index = ranked.findIndex((entry) => entry.candidate === staff);
  if (index === 0) return 'treble';
  if (index === 1) return 'bass';
  return 'other';
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
    rootCoordinateSource: renderedRoot
      ? renderedRoot.source
      : rootFailureReason
        ? null
        : 'matrix_to_root',
    rootFailureReason,
  };
}

export function snapshotPlayheadCursorGeometry(
  container: ParentNode,
  noteIds: readonly string[]
): PlayheadCursorGeometrySnapshot | null {
  const geometry = getPlayheadCursorGeometry(container, noteIds, { requireRootCoordinates: true });
  if (!geometry) {
    return null;
  }
  return {
    box: { ...geometry.box },
    noteBox: { ...geometry.noteBox },
    systemBox: { ...geometry.systemBox },
    rootBox: geometry.rootBox ? { ...geometry.rootBox } : null,
    rootNoteBox: geometry.rootNoteBox ? { ...geometry.rootNoteBox } : null,
    rootSystemBox: geometry.rootSystemBox ? { ...geometry.rootSystemBox } : null,
    rootCoordinateSource: geometry.rootCoordinateSource,
    rootFailureReason: geometry.rootFailureReason,
  };
}

export function rootSvgRectForElement(
  rootSvg: SVGSVGElement,
  element: SVGGraphicsElement
): SvgRect | null {
  let box: DOMRect;
  try {
    box = element.getBBox();
  } catch {
    return null;
  }
  if (element === rootSvg) {
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }

  const rootRect = rootSvg.getBoundingClientRect?.();
  const elementRect = element.getBoundingClientRect?.();
  const viewBox = readSvgViewBox(rootSvg);
  if (
    rootRect &&
    elementRect &&
    rootRect.width > 0 &&
    rootRect.height > 0 &&
    elementRect.width > 0 &&
    elementRect.height > 0 &&
    elementRect.right >= rootRect.left &&
    elementRect.left <= rootRect.right &&
    elementRect.bottom >= rootRect.top &&
    elementRect.top <= rootRect.bottom
  ) {
    const rect = {
      x: viewBox.x + ((elementRect.left - rootRect.left) / rootRect.width) * viewBox.width,
      y: viewBox.y + ((elementRect.top - rootRect.top) / rootRect.height) * viewBox.height,
      width: (elementRect.width / rootRect.width) * viewBox.width,
      height: (elementRect.height / rootRect.height) * viewBox.height,
    };
    if (isFiniteRect(rect)) {
      return rect;
    }
  }

  const elementCtm = element.getCTM?.();
  const rootCtm = rootSvg.getCTM?.();
  if (elementCtm && rootCtm && typeof rootCtm.inverse === 'function') {
    try {
      const rootInverse = rootCtm.inverse();
      const matrix = rootInverse.multiply(elementCtm);
      const points = [
        [box.x, box.y],
        [box.x + box.width, box.y],
        [box.x, box.y + box.height],
        [box.x + box.width, box.y + box.height],
      ].map(([x, y]) => {
        const point = rootSvg.createSVGPoint();
        point.x = x;
        point.y = y;
        return point.matrixTransform(matrix);
      });
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      const rect = {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      };
      if (isFiniteRect(rect)) {
        return rect;
      }
    } catch {
      // Use the browser-layout fallback only when both elements are measurable.
    }
  }

  if (
    rootRect &&
    elementRect &&
    rootRect.width > 0 &&
    rootRect.height > 0 &&
    elementRect.width > 0 &&
    elementRect.height > 0
  ) {
    const rect = {
      x: viewBox.x + ((elementRect.left - rootRect.left) / rootRect.width) * viewBox.width,
      y: viewBox.y + ((elementRect.top - rootRect.top) / rootRect.height) * viewBox.height,
      width: (elementRect.width / rootRect.width) * viewBox.width,
      height: (elementRect.height / rootRect.height) * viewBox.height,
    };
    return isFiniteRect(rect) ? rect : null;
  }
  return null;
}

export function mergePlayheadCursorGeometrySnapshots(
  snapshots: readonly PlayheadCursorGeometrySnapshot[]
): PlayheadCursorGeometrySnapshot | null {
  if (snapshots.length === 0) {
    return null;
  }
  const rootNoteBoxes = snapshots.map((snapshot) => snapshot.rootNoteBox).filter(isSvgRect);
  const rootSystemBoxes = snapshots.map((snapshot) => snapshot.rootSystemBox).filter(isSvgRect);
  if (rootNoteBoxes.length !== snapshots.length || rootSystemBoxes.length === 0) {
    return null;
  }
  const rootNoteBox = rootNoteBoxes.reduce(mergeRects);
  const rootSystemBox = rootSystemBoxes.reduce(mergeRects);
  const rootBox = cursorBoxFor(rootNoteBox, rootSystemBox);
  const first = snapshots[0];
  return {
    box: snapshots.map((snapshot) => snapshot.box).reduce(mergeRects),
    noteBox: snapshots.map((snapshot) => snapshot.noteBox).reduce(mergeRects),
    systemBox: snapshots.map((snapshot) => snapshot.systemBox).reduce(mergeRects),
    rootBox,
    rootNoteBox,
    rootSystemBox,
    rootCoordinateSource: first.rootCoordinateSource,
    rootFailureReason: null,
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
): {
  rootBox: SvgRect;
  rootNoteBox: SvgRect;
  rootSystemBox: SvgRect;
  source: PlayheadRootCoordinateSource;
} | null {
  const ctmRoot = getRootGeometryFromSource(rootSvg, layer, notes, ctmViewportRectToRootSvg);
  if (ctmRoot) {
    return { ...ctmRoot, source: 'ctm_svg_viewport' };
  }
  const renderedRoot = getRootGeometryFromSource(rootSvg, layer, notes, renderedRectToRootSvg);
  return renderedRoot ? { ...renderedRoot, source: 'rendered_dom_rect' } : null;
}

function getRootGeometryFromSource(
  rootSvg: SVGSVGElement,
  layer: SVGGraphicsElement,
  notes: readonly SVGGraphicsElement[],
  getRootRect: (rootSvg: SVGSVGElement, element: SVGGraphicsElement) => SvgRect | null
) {
  const rootNoteBoxes = notes
    .map((note) => getRootRect(rootSvg, note))
    .filter((box): box is SvgRect => box !== null);
  if (rootNoteBoxes.length === 0) {
    return null;
  }
  const rootNoteBox = rootNoteBoxes.reduce(mergeRects);
  const rootSystemBox = getRootRect(rootSvg, layer) ?? rootNoteBox;
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

function ctmViewportRectToRootSvg(
  rootSvg: SVGSVGElement,
  element: SVGGraphicsElement
): SvgRect | null {
  const viewportRect = getViewportRectFromCtm(element);
  if (!viewportRect) {
    return null;
  }
  return viewportRectToRootSvg(rootSvg, viewportRect);
}

function getViewportRectFromCtm(element: SVGGraphicsElement): SvgRect | null {
  let box: DOMRect;
  try {
    box = element.getBBox();
  } catch {
    return null;
  }
  const ctm = element.getCTM?.();
  if (!ctm) {
    return null;
  }
  const corners = [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x, box.y + box.height],
    [box.x + box.width, box.y + box.height],
  ].map(([x, y]) => ({
    x: ctm.a * x + ctm.c * y + ctm.e,
    y: ctm.b * x + ctm.d * y + ctm.f,
  }));
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const rect = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
  return isFiniteRect(rect) ? rect : null;
}

function viewportRectToRootSvg(rootSvg: SVGSVGElement, viewportRect: SvgRect): SvgRect | null {
  const rootViewport = getRootSvgViewportRect(rootSvg);
  if (!rootViewport) {
    return null;
  }
  const viewBox = readSvgViewBox(rootSvg);
  const rect = {
    x: viewBox.x + ((viewportRect.x - rootViewport.x) / rootViewport.width) * viewBox.width,
    y: viewBox.y + ((viewportRect.y - rootViewport.y) / rootViewport.height) * viewBox.height,
    width: (viewportRect.width / rootViewport.width) * viewBox.width,
    height: (viewportRect.height / rootViewport.height) * viewBox.height,
  };
  return isFiniteRect(rect) ? rect : null;
}

function getRootSvgViewportRect(rootSvg: SVGSVGElement): SvgRect | null {
  const width = parseSvgLength(rootSvg.getAttribute('width'));
  const height = parseSvgLength(rootSvg.getAttribute('height'));
  if (width > 0 && height > 0) {
    return { x: 0, y: 0, width, height };
  }
  const viewBox = readSvgViewBox(rootSvg);
  return { x: 0, y: 0, width: viewBox.width, height: viewBox.height };
}

function parseSvgLength(value: string | null) {
  if (!value) {
    return 0;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

function isSvgRect(rect: SvgRect | null): rect is SvgRect {
  return rect !== null && isFiniteRect(rect);
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

function mergeHorizontalRects(current: SvgRect | null, next: SvgRect): SvgRect {
  if (!current) {
    return { ...next };
  }
  const left = Math.min(current.x, next.x);
  const right = Math.max(current.x + current.width, next.x + next.width);
  return {
    x: left,
    y: current.y,
    width: right - left,
    height: current.height,
  };
}
