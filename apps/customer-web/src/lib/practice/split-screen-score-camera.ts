import type { SvgRect } from './playhead-cursor';
import type { SvgViewBox } from './split-screen-score-model';

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function scoreViewportForLine({
  viewBox,
  lineBox,
  activeNoteBox,
  viewportByLineKey,
  lineKey,
}: {
  viewBox: SvgViewBox;
  lineBox: SvgRect;
  activeNoteBox: SvgRect;
  viewportByLineKey: Map<string, SvgRect>;
  lineKey: string;
}): SvgRect {
  const cached = viewportByLineKey.get(lineKey);
  if (cached && rectContains(cached, activeNoteBox)) {
    return cached;
  }
  const contextPadding = Math.max(24, lineBox.height * 0.18);
  const desiredHeight = Math.min(
    viewBox.height,
    Math.max(lineBox.height + contextPadding * 2, viewBox.height * 0.34)
  );
  let y = lineBox.y + lineBox.height / 2 - desiredHeight / 2;
  y = Math.max(viewBox.y, Math.min(y, viewBox.y + viewBox.height - desiredHeight));
  const viewport = {
    x: viewBox.x,
    y,
    width: viewBox.width,
    height: desiredHeight,
  };
  if (!rectContains(viewport, activeNoteBox)) {
    y = activeNoteBox.y + activeNoteBox.height / 2 - desiredHeight / 2;
    viewport.y = Math.max(viewBox.y, Math.min(y, viewBox.y + viewBox.height - desiredHeight));
  }
  viewportByLineKey.set(lineKey, viewport);
  return viewport;
}

export function svgRectToCanvasRect(rect: SvgRect, viewport: SvgRect, imageRect: Rect): Rect {
  const scaleX = imageRect.width / viewport.width;
  const scaleY = imageRect.height / viewport.height;
  return {
    x: imageRect.x + (rect.x - viewport.x) * scaleX,
    y: imageRect.y + (rect.y - viewport.y) * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY,
  };
}

export function exportCursorRect(
  activeNoteBox: SvgRect,
  viewport: SvgRect,
  imageRect: Rect,
  paddingPx = 5
): Rect {
  return clampRectToRect(
    inflateRect(svgRectToCanvasRect(activeNoteBox, viewport, imageRect), paddingPx),
    imageRect
  );
}

export function rectsIntersect(first: Rect, second: Rect) {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

export function rectContains(outer: Rect, inner: Rect) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function inflateRect(rect: Rect, padding: number): Rect {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
}

function clampRectToRect(rect: Rect, bounds: Rect): Rect {
  const x = Math.max(bounds.x, rect.x);
  const y = Math.max(bounds.y, rect.y);
  const right = Math.min(bounds.x + bounds.width, rect.x + rect.width);
  const bottom = Math.min(bounds.y + bounds.height, rect.y + rect.height);
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}
